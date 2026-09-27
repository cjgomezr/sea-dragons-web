import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { DEFAULT_CLUB_SLUG } from "@/lib/auth/supabase-auth-gateways";
import { listNewsFeed } from "@/lib/news/news-feed";
import {
  ForeignNewsGroupError,
  type NewsDraft,
  NewsPostNotFoundError,
  type NewsPostDetail,
  openNewsPost,
} from "@/lib/news/news-posts";
import type { NewsAttachmentGateways } from "@/lib/news/news-attachments";
import {
  NewsPostChangedError,
  changeNewsPostStatus,
  editNewsPost,
} from "@/lib/news/news-management";
import { publishNewsPostWithUploads } from "@/lib/news/news-uploads";
import { createNewsAttachmentGateways } from "@/lib/news/supabase-news-attachment-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
  withTestUser,
} from "../../support/rls";

/**
 * Publicar, el feed y abrir una publicación contra `seadragons-dev` (#327).
 * Lo que ningún doble puede afirmar: que la consulta de verdad del feed deja
 * fuera lo que va a un grupo ajeno, trae el autor y cuenta los adjuntos, y que
 * la retirada sólo la abre quien la publicó.
 */

type SeededClub = {
  readonly clubId: string;
  readonly admin: TestUser;
  readonly squadMember: TestUser;
  readonly outsider: TestUser;
  readonly squadId: string;
  readonly gateways: NewsAttachmentGateways;
};

async function readClubId(serviceClient: ServiceRoleClient): Promise<string> {
  const { data, error } = await serviceClient.client
    .from("clubs")
    .select("id")
    .eq("slug", DEFAULT_CLUB_SLUG)
    .single();
  if (error) {
    throw new Error(`No se pudo leer el club sembrado: ${error.message}`);
  }
  return data.id as string;
}

function memberRow(
  clubId: string,
  user: TestUser,
  role: "Admin" | "Player",
): Record<string, unknown> {
  return {
    club_id: clubId,
    user_id: user.id,
    full_name: role === "Admin" ? "Ada Admin" : "Pía Player",
    email: user.email,
    account_status: "active",
    role,
  };
}

async function runSupabase(
  action: string,
  request: PromiseLike<{ readonly error: { message: string } | null }>,
): Promise<void> {
  const { error } = await request;
  if (error) {
    throw new Error(`No se pudo ${action}: ${error.message}`);
  }
}

/** Las publicaciones se borran antes que los socios: la clave del autor no
 * deja borrar a quien publicó. */
async function withAuthorPosts<T>(
  serviceClient: ServiceRoleClient,
  authorId: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } finally {
    // Editar y retirar dejan su entrada (#331); nombra al autor como actor.
    await runSupabase(
      "borrar la bitácora de la prueba",
      serviceClient.client.from("audit_log").delete().eq("actor_id", authorId),
    );
    await runSupabase(
      "borrar las publicaciones de la prueba",
      serviceClient.client
        .from("news_posts")
        .delete()
        .eq("author_id", authorId),
    );
  }
}

/** Un Admin, un socio de un grupo y otro sin grupos. Todo se deshace. */
async function withSeededClub<T>(
  serviceClient: ServiceRoleClient,
  run: (seeded: SeededClub) => Promise<T>,
): Promise<T> {
  const clubId = await readClubId(serviceClient);
  return withTestUser(serviceClient, (admin) =>
    withTestUser(serviceClient, (squadMember) =>
      withTestUser(serviceClient, (outsider) =>
        withSeededRows(
          serviceClient,
          "members",
          [
            memberRow(clubId, admin, "Admin"),
            memberRow(clubId, squadMember, "Player"),
            memberRow(clubId, outsider, "Player"),
          ],
          () =>
            withSeededRows(
              serviceClient,
              "groups",
              [{ club_id: clubId, name: `News Squad ${randomUUID()}` }],
              async ([squad]) => {
                const squadId = squad?.id as string;
                await runSupabase(
                  "sembrar la pertenencia al grupo",
                  serviceClient.client.from("group_memberships").insert({
                    club_id: clubId,
                    group_id: squadId,
                    user_id: squadMember.id,
                  }),
                );
                return withAuthorPosts(serviceClient, admin.id, () =>
                  run({
                    clubId,
                    admin,
                    squadMember,
                    outsider,
                    squadId,
                    gateways: createNewsAttachmentGateways(
                      serviceClient.client,
                    ),
                  }),
                );
              },
            ),
        ),
      ),
    ),
  );
}

/** Publicar sin adjuntos: el mismo camino que usa el endpoint (#330). */
function publishWithoutAttachments(
  gateways: NewsAttachmentGateways,
  request: { readonly callerId: string; readonly draft: NewsDraft },
): Promise<NewsPostDetail> {
  return publishNewsPostWithUploads(gateways, {
    ...request,
    uploadIds: [],
    now: new Date(),
  });
}

describeRls("noticias contra seadragons-dev", () => {
  it(
    "una publicación dirigida a un grupo la ve un miembro de ese grupo y no la ve otro",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withSeededClub(serviceClient, async (seeded) => {
        const post = await publishWithoutAttachments(seeded.gateways, {
          callerId: seeded.admin.id,
          draft: {
            category: "announcement",
            title: "Sólo para el grupo",
            body: "Entrenamiento extra el jueves.",
            audience: { kind: "groups", groupIds: [seeded.squadId] },
          },
        });

        const squadFeed = await listNewsFeed(seeded.gateways, {
          callerId: seeded.squadMember.id,
        });
        const outsiderFeed = await listNewsFeed(seeded.gateways, {
          callerId: seeded.outsider.id,
        });

        expect(squadFeed.posts.map((row) => row.id)).toContain(post.id);
        expect(outsiderFeed.posts.map((row) => row.id)).not.toContain(post.id);
        await expect(
          openNewsPost(seeded.gateways, {
            callerId: seeded.outsider.id,
            postId: post.id,
          }),
        ).rejects.toBeInstanceOf(NewsPostNotFoundError);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "el feed trae el autor y la cuenta de adjuntos, y la publicación abierta sus adjuntos",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withSeededClub(serviceClient, async (seeded) => {
        const post = await publishWithoutAttachments(seeded.gateways, {
          callerId: seeded.admin.id,
          draft: {
            category: "document",
            title: "Política de seguridad",
            body: "Léela antes de bucear.",
            audience: { kind: "club" },
          },
        });
        await runSupabase(
          "sembrar un adjunto",
          serviceClient.client.from("news_post_attachments").insert({
            post_id: post.id,
            club_id: seeded.clubId,
            file_name: "politica.pdf",
            content_type: "application/pdf",
            size_bytes: 2048,
            storage_path: `pruebas/${randomUUID()}.pdf`,
          }),
        );

        const feed = await listNewsFeed(seeded.gateways, {
          callerId: seeded.outsider.id,
        });
        const opened = await openNewsPost(seeded.gateways, {
          callerId: seeded.outsider.id,
          postId: post.id,
        });

        expect(feed.posts.find((row) => row.id === post.id)).toMatchObject({
          author: { id: seeded.admin.id, fullName: "Ada Admin" },
          attachmentCount: 1,
          excerpt: "Léela antes de bucear.",
        });
        expect(opened.attachments).toEqual([
          {
            id: expect.any(String),
            fileName: "politica.pdf",
            contentType: "application/pdf",
            sizeBytes: 2048,
          },
        ]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "la retirada sale del feed y sólo la abre quien la publicó",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withSeededClub(serviceClient, async (seeded) => {
        const post = await publishWithoutAttachments(seeded.gateways, {
          callerId: seeded.admin.id,
          draft: {
            category: "news",
            title: "Ya no aplica",
            body: "Se retira.",
            audience: { kind: "club" },
          },
        });
        await runSupabase(
          "retirar la publicación",
          serviceClient.client
            .from("news_posts")
            .update({ status: "withdrawn" })
            .eq("id", post.id),
        );

        const feed = await listNewsFeed(seeded.gateways, {
          callerId: seeded.squadMember.id,
        });
        const openedByAuthor = await openNewsPost(seeded.gateways, {
          callerId: seeded.admin.id,
          postId: post.id,
        });

        expect(feed.posts.map((row) => row.id)).not.toContain(post.id);
        expect(openedByAuthor.status).toBe("withdrawn");
        await expect(
          openNewsPost(seeded.gateways, {
            callerId: seeded.squadMember.id,
            postId: post.id,
          }),
        ).rejects.toBeInstanceOf(NewsPostNotFoundError);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "la página siguiente empieza justo después de la última fila",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withSeededClub(serviceClient, async (seeded) => {
        const draft = {
          category: "news",
          body: "Cuerpo.",
          audience: { kind: "club" },
        } as const;
        const older = await publishWithoutAttachments(seeded.gateways, {
          callerId: seeded.admin.id,
          draft: { ...draft, title: "La anterior" },
        });
        const newer = await publishWithoutAttachments(seeded.gateways, {
          callerId: seeded.admin.id,
          draft: { ...draft, title: "La siguiente" },
        });

        const rows = await seeded.gateways.posts.findFeedPage({
          clubId: seeded.clubId,
          readerId: seeded.outsider.id,
          audienceGroupIds: [],
          after: { publishedAt: newer.publishedAt, id: newer.id },
          limit: 1,
        });

        expect(rows.map((row) => row.id)).toEqual([older.id]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un grupo que no es del club no deja escribir nada",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withSeededClub(serviceClient, async (seeded) => {
        await expect(
          publishWithoutAttachments(seeded.gateways, {
            callerId: seeded.admin.id,
            draft: {
              category: "news",
              title: "A un grupo ajeno",
              body: "No debería guardarse.",
              audience: { kind: "groups", groupIds: [randomUUID()] },
            },
          }),
        ).rejects.toBeInstanceOf(ForeignNewsGroupError);

        const { count, error } = await serviceClient.client
          .from("news_posts")
          .select("id", { count: "exact", head: true })
          .eq("author_id", seeded.admin.id);
        expect(error).toBeNull();
        expect(count).toBe(0);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "editar guarda la marca, amplía y reduce la audiencia de verdad, y la segunda edición sobre lo viejo es un conflicto (#331)",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withSeededClub(serviceClient, async (seeded) => {
        const draft = {
          category: "news",
          title: "Sólo para el grupo",
          body: "Entrenamiento extra.",
          audience: { kind: "groups", groupIds: [seeded.squadId] },
        } as const;
        const post = await publishWithoutAttachments(seeded.gateways, {
          callerId: seeded.admin.id,
          draft,
        });
        const feedIdsOf = async (callerId: string): Promise<string[]> =>
          (await listNewsFeed(seeded.gateways, { callerId })).posts.map(
            (row) => row.id,
          );

        const widened = await editNewsPost(seeded.gateways, {
          callerId: seeded.admin.id,
          postId: post.id,
          draft: {
            ...draft,
            title: "Para todo el club",
            audience: { kind: "club" },
          },
          expectedEditedAt: null,
          now: new Date(),
        });
        expect(widened.title).toBe("Para todo el club");
        expect(widened.editedAt).not.toBeNull();
        expect(await feedIdsOf(seeded.outsider.id)).toContain(post.id);

        await expect(
          editNewsPost(seeded.gateways, {
            callerId: seeded.admin.id,
            postId: post.id,
            draft: { ...draft, title: "Pisaría a la primera" },
            expectedEditedAt: null,
            now: new Date(),
          }),
        ).rejects.toBeInstanceOf(NewsPostChangedError);

        await editNewsPost(seeded.gateways, {
          callerId: seeded.admin.id,
          postId: post.id,
          draft,
          expectedEditedAt: widened.editedAt,
          now: new Date(),
        });
        expect(await feedIdsOf(seeded.outsider.id)).not.toContain(post.id);
        expect(await feedIdsOf(seeded.squadMember.id)).toContain(post.id);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "retirar la saca del feed de los demás y la deja marcada en el de quien publicó, sin avisar al volver (#331)",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withSeededClub(serviceClient, async (seeded) => {
        const post = await publishWithoutAttachments(seeded.gateways, {
          callerId: seeded.admin.id,
          draft: {
            category: "announcement",
            title: "Se retira",
            body: "Ya no aplica.",
            audience: { kind: "club" },
          },
        });
        const countNotifications = async (): Promise<number | null> => {
          const { count, error } = await serviceClient.client
            .from("notifications")
            .select("id", { count: "exact", head: true })
            .eq("user_id", seeded.outsider.id);
          expect(error).toBeNull();
          return count;
        };
        const notificationsBefore = await countNotifications();

        await changeNewsPostStatus(seeded.gateways, {
          callerId: seeded.admin.id,
          postId: post.id,
          status: "withdrawn",
        });
        const outsiderFeed = await listNewsFeed(seeded.gateways, {
          callerId: seeded.outsider.id,
        });
        const authorFeed = await listNewsFeed(seeded.gateways, {
          callerId: seeded.admin.id,
        });
        expect(outsiderFeed.posts.map((row) => row.id)).not.toContain(post.id);
        expect(authorFeed.posts.find((row) => row.id === post.id)?.status).toBe(
          "withdrawn",
        );

        await changeNewsPostStatus(seeded.gateways, {
          callerId: seeded.admin.id,
          postId: post.id,
          status: "published",
        });
        const backFeed = await listNewsFeed(seeded.gateways, {
          callerId: seeded.outsider.id,
        });
        expect(backFeed.posts.map((row) => row.id)).toContain(post.id);
        expect(await countNotifications()).toBe(notificationsBefore);

        const { data, error } = await serviceClient.client
          .from("audit_log")
          .select("action, entity_type, entity_id, metadata")
          .eq("actor_id", seeded.admin.id)
          .order("created_at");
        expect(error).toBeNull();
        expect(data).toEqual([
          {
            action: "news_post.withdrawn",
            entity_type: "news_post",
            entity_id: post.id,
            metadata: null,
          },
          {
            action: "news_post.republished",
            entity_type: "news_post",
            entity_id: post.id,
            metadata: null,
          },
        ]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
