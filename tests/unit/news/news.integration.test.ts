import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { expect, it } from "vitest";
import { stageNewsCover } from "@/lib/news/news-cover-uploads";
import { listNewsFeed } from "@/lib/news/news-feed";
import {
  ForeignNewsGroupError,
  type NewsDraft,
  NewsPostNotFoundError,
  type NewsPostDetail,
  openNewsPost,
} from "@/lib/news/news-posts";
import type { NewsPublishGateways } from "@/lib/news/news-publication-notice";
import {
  NewsPostChangedError,
  changeNewsPostStatus,
  editNewsPost,
} from "@/lib/news/news-management";
import { publishNewsPostWithUploads } from "@/lib/news/news-uploads";
import { pinNewsPost, unpinNewsPost } from "@/lib/news/news-pins";
import { NEWS_ATTACHMENTS_BUCKET } from "@/lib/news/supabase-news-attachment-gateways";
import { createNewsPublishGateways } from "@/lib/news/supabase-news-publish-gateways";
import { createSupabaseNotificationWriter } from "@/lib/notifications/supabase-notification-gateways";
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
  readonly gateways: NewsPublishGateways;
};

/** Publicar avisa a todo el club (#332): en el club sembrado llegaría a sus
 * socios de verdad. La limpieza de avisos corre en el acto, porque aquí no
 * hay petición a la que esperar. */
function withThrowawayClub<T>(
  serviceClient: ServiceRoleClient,
  run: (clubId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    "clubs",
    [{ slug: `noticias-${randomUUID()}`, name: "Club de las noticias" }],
    ([club]) => run(club?.id as string),
  );
}

function publishGatewaysFor(
  serviceClient: ServiceRoleClient,
): NewsPublishGateways {
  return {
    ...createNewsPublishGateways(serviceClient.client),
    notifications: createSupabaseNotificationWriter(
      serviceClient.client,
      (work) => void work(),
    ),
  };
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

/** Un club desechable con un Admin, un socio de un grupo y otro sin grupos.
 * Todo se deshace. */
async function withSeededClub<T>(
  serviceClient: ServiceRoleClient,
  run: (seeded: SeededClub) => Promise<T>,
): Promise<T> {
  return withThrowawayClub(serviceClient, (clubId) =>
    withTestUser(serviceClient, (admin) =>
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
                      gateways: publishGatewaysFor(serviceClient),
                    }),
                  );
                },
              ),
          ),
        ),
      ),
    ),
  );
}

/** Publicar sin adjuntos: el mismo camino que usa el endpoint (#330). */
function publishWithoutAttachments(
  gateways: NewsPublishGateways,
  request: { readonly callerId: string; readonly draft: NewsDraft },
): Promise<NewsPostDetail> {
  return publishNewsPostWithUploads(gateways, {
    ...request,
    uploadIds: [],
    coverUploadId: null,
    pin: { kind: "keep" },
    now: new Date(),
  });
}

/** Una foto pequeña de verdad, para que sharp la reduzca. */
async function aCoverPicture(): Promise<Uint8Array> {
  const picture = sharp({
    create: {
      width: 400,
      height: 300,
      channels: 3,
      background: { r: 20, g: 60, b: 110 },
    },
  });
  return new Uint8Array(await picture.png().toBuffer());
}

async function listCoverFiles(
  serviceClient: ServiceRoleClient,
  clubId: string,
): Promise<readonly string[]> {
  const { data, error } = await serviceClient.client.storage
    .from(NEWS_ATTACHMENTS_BUCKET)
    .list(`${clubId}/covers`);
  if (error) {
    throw new Error(`No se pudieron listar las portadas: ${error.message}`);
  }
  return data.map((file) => file.name).sort();
}

/** La cascada del club no alcanza a Storage: las portadas se borran aparte. */
async function withCoverCleanup(
  serviceClient: ServiceRoleClient,
  clubId: string,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } finally {
    const leftovers = await listCoverFiles(serviceClient, clubId);
    if (leftovers.length > 0) {
      await runSupabase(
        "borrar las portadas de la prueba",
        serviceClient.client.storage
          .from(NEWS_ATTACHMENTS_BUCKET)
          .remove(leftovers.map((name) => `${clubId}/covers/${name}`)),
      );
    }
  }
}

async function stageCover(seeded: SeededClub): Promise<string> {
  const cover = await stageNewsCover(seeded.gateways, {
    callerId: seeded.admin.id,
    fileName: "portada.png",
    bytes: await aCoverPicture(),
  });
  return cover.id;
}

function publishWithCover(
  seeded: SeededClub,
  coverUploadId: string,
  audience: NewsDraft["audience"],
): Promise<NewsPostDetail> {
  return publishNewsPostWithUploads(seeded.gateways, {
    callerId: seeded.admin.id,
    draft: {
      category: "news",
      title: "Crónica del torneo",
      body: "Ganamos la final.",
      audience,
    },
    uploadIds: [],
    coverUploadId,
    pin: { kind: "keep" },
    now: new Date(),
  });
}

/** Lo que responde Storage a la dirección firmada. */
async function fetchCover(url: string | null | undefined): Promise<string> {
  if (url === null || url === undefined) {
    throw new Error("Falta la dirección de la portada.");
  }
  const response = await fetch(url);
  return `${response.status} ${response.headers.get("content-type")}`;
}

describeRls("portadas de noticias contra seadragons-dev (#591)", () => {
  it(
    "la audiencia recibe la miniatura y la grande firmadas, y quien no es audiencia no la recibe",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withSeededClub(serviceClient, (seeded) =>
        withCoverCleanup(serviceClient, seeded.clubId, async () => {
          const coverId = await stageCover(seeded);
          const post = await publishWithCover(seeded, coverId, {
            kind: "groups",
            groupIds: [seeded.squadId],
          });

          const memberFeed = await listNewsFeed(seeded.gateways, {
            callerId: seeded.squadMember.id,
          });
          const memberPost = await openNewsPost(seeded.gateways, {
            callerId: seeded.squadMember.id,
            postId: post.id,
          });
          const outsiderFeed = await listNewsFeed(seeded.gateways, {
            callerId: seeded.outsider.id,
          });

          const [item] = memberFeed.posts;
          expect(await fetchCover(item?.coverThumbnailUrl)).toBe(
            "200 image/webp",
          );
          expect(await fetchCover(item?.coverUrl)).toBe("200 image/webp");
          expect(await fetchCover(memberPost.coverUrl)).toBe("200 image/webp");
          expect(await listCoverFiles(serviceClient, seeded.clubId)).toEqual([
            `${coverId}-large.webp`,
            `${coverId}-thumb.webp`,
          ]);
          expect(outsiderFeed.posts).toEqual([]);
          await expect(
            openNewsPost(seeded.gateways, {
              callerId: seeded.outsider.id,
              postId: post.id,
            }),
          ).rejects.toBeInstanceOf(NewsPostNotFoundError);
        }),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "una retirada no sirve su portada a quien no la publicó",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withSeededClub(serviceClient, (seeded) =>
        withCoverCleanup(serviceClient, seeded.clubId, async () => {
          const post = await publishWithCover(
            seeded,
            await stageCover(seeded),
            { kind: "club" },
          );

          await changeNewsPostStatus(seeded.gateways, {
            callerId: seeded.admin.id,
            postId: post.id,
            status: "withdrawn",
          });
          const memberFeed = await listNewsFeed(seeded.gateways, {
            callerId: seeded.squadMember.id,
          });

          expect(memberFeed.posts).toEqual([]);
          await expect(
            openNewsPost(seeded.gateways, {
              callerId: seeded.squadMember.id,
              postId: post.id,
            }),
          ).rejects.toBeInstanceOf(NewsPostNotFoundError);
        }),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "cambiar la portada sirve la nueva y borra la anterior del bucket y de la base",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withSeededClub(serviceClient, (seeded) =>
        withCoverCleanup(serviceClient, seeded.clubId, async () => {
          const oldCoverId = await stageCover(seeded);
          const post = await publishWithCover(seeded, oldCoverId, {
            kind: "club",
          });
          const newCoverId = await stageCover(seeded);

          const edited = await editNewsPost(seeded.gateways, {
            callerId: seeded.admin.id,
            postId: post.id,
            draft: {
              category: "news",
              title: "Crónica del torneo",
              body: "Ganamos la final.",
              audience: { kind: "club" },
            },
            expectedEditedAt: null,
            cover: { kind: "replace", coverUploadId: newCoverId },
            pin: { kind: "keep" },
            now: new Date(),
          });
          const { data, error } = await serviceClient.client
            .from("news_cover_uploads")
            .select("id")
            .eq("club_id", seeded.clubId);

          expect(edited.coverUrl).toContain(newCoverId);
          expect(await listCoverFiles(serviceClient, seeded.clubId)).toEqual([
            `${newCoverId}-large.webp`,
            `${newCoverId}-thumb.webp`,
          ]);
          expect(error).toBeNull();
          expect(data).toEqual([{ id: newCoverId }]);
        }),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});

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
          now: new Date().toISOString(),
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
          cover: { kind: "keep" },
          pin: { kind: "keep" },
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
            cover: { kind: "keep" },
            pin: { kind: "keep" },
            now: new Date(),
          }),
        ).rejects.toBeInstanceOf(NewsPostChangedError);

        await editNewsPost(seeded.gateways, {
          callerId: seeded.admin.id,
          postId: post.id,
          draft,
          expectedEditedAt: widened.editedAt,
          cover: { kind: "keep" },
          pin: { kind: "keep" },
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

  it(
    "publicar a un grupo deja un aviso a cada miembro del grupo y ninguno a quien está fuera ni a quien publica (#332)",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withSeededClub(serviceClient, async (seeded) => {
        const post = await publishWithoutAttachments(seeded.gateways, {
          callerId: seeded.admin.id,
          draft: {
            category: "news",
            title: "Torneo en Sídney",
            body: "Apuntaos antes del viernes.",
            audience: { kind: "groups", groupIds: [seeded.squadId] },
          },
        });

        const { data, error } = await serviceClient.client
          .from("notifications")
          .select("user_id, type, data")
          .eq("club_id", seeded.clubId);
        expect(error).toBeNull();
        expect(data).toEqual([
          {
            user_id: seeded.squadMember.id,
            type: "news_post_published",
            data: {
              postId: post.id,
              category: "news",
              title: "Torneo en Sídney",
            },
          },
        ]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "publicar a todo el club avisa a cada socio activo menos a quien publica (#332)",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withSeededClub(serviceClient, async (seeded) => {
        await publishWithoutAttachments(seeded.gateways, {
          callerId: seeded.admin.id,
          draft: {
            category: "announcement",
            title: "Cambia la piscina",
            body: "El martes entrenamos en MSAC.",
            audience: { kind: "club" },
          },
        });

        const { data, error } = await serviceClient.client
          .from("notifications")
          .select("user_id")
          .eq("club_id", seeded.clubId);
        expect(error).toBeNull();
        expect(data?.map((row) => row.user_id).sort()).toEqual(
          [seeded.squadMember.id, seeded.outsider.id].sort(),
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
/** Las filas de las publicaciones del club, en bloque y con su fecha, para
 * llenar más de una página del feed sin publicar una a una. Vuelven de la más
 * reciente a la más antigua, como las ordena el feed. */
async function insertDatedPosts(
  serviceClient: ServiceRoleClient,
  seeded: SeededClub,
  count: number,
): Promise<readonly string[]> {
  const { data, error } = await serviceClient.client
    .from("news_posts")
    .insert(
      Array.from({ length: count }, (_, index) => ({
        club_id: seeded.clubId,
        author_id: seeded.admin.id,
        category: "news",
        title: `Crónica ${index}`,
        body: "Ganamos.",
        audience: "club",
        published_at: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
      })),
    )
    .select("id, published_at");
  if (error) {
    throw new Error(
      `No se pudieron sembrar las publicaciones: ${error.message}`,
    );
  }
  return [...data]
    .sort((first, second) =>
      String(second.published_at).localeCompare(String(first.published_at)),
    )
    .map((row) => String(row.id));
}

async function readPinActions(
  serviceClient: ServiceRoleClient,
  seeded: SeededClub,
): Promise<readonly unknown[]> {
  const { data, error } = await serviceClient.client
    .from("audit_log")
    .select("action, entity_id, metadata")
    .eq("club_id", seeded.clubId)
    .in("action", ["news_post.pinned", "news_post.unpinned"])
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`No se pudo leer la bitácora: ${error.message}`);
  }
  return data;
}

async function readPinnedIds(
  serviceClient: ServiceRoleClient,
  seeded: SeededClub,
): Promise<readonly string[]> {
  const { data, error } = await serviceClient.client
    .from("news_posts")
    .select("id")
    .eq("club_id", seeded.clubId)
    .not("pinned_at", "is", null);
  if (error) {
    throw new Error(`No se pudieron leer las fijadas: ${error.message}`);
  }
  return data.map((row) => String(row.id));
}

const PIN_UNTIL = "2999-01-01T00:00:00.000Z";
const PIN_UNTIL_AS_STORED = /^2999-01-01T00:00:00/;

describeRls("fijar noticias contra seadragons-dev (#592)", () => {
  it(
    "fijar otra desfija la anterior, y la bitácora guarda las dos acciones con su fecha de fin",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withSeededClub(serviceClient, async (seeded) => {
        const [first, second] = await insertDatedPosts(
          serviceClient,
          seeded,
          2,
        );
        const admin = { callerId: seeded.admin.id, now: new Date() };

        await pinNewsPost(seeded.gateways, {
          ...admin,
          postId: String(first),
          until: PIN_UNTIL,
        });
        const pinned = await pinNewsPost(seeded.gateways, {
          ...admin,
          postId: String(second),
          until: null,
        });

        expect(pinned).toMatchObject({ isPinned: true, pinnedUntil: null });
        await expect(readPinnedIds(serviceClient, seeded)).resolves.toEqual([
          second,
        ]);
        await expect(readPinActions(serviceClient, seeded)).resolves.toEqual([
          {
            action: "news_post.pinned",
            entity_id: first,
            metadata: { until: PIN_UNTIL },
          },
          {
            action: "news_post.unpinned",
            entity_id: first,
            metadata: { until: expect.stringMatching(PIN_UNTIL_AS_STORED) },
          },
          {
            action: "news_post.pinned",
            entity_id: second,
            metadata: { until: null },
          },
        ]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "dos fijados a la vez sobre publicaciones distintas dejan una sola fijada",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withSeededClub(serviceClient, async (seeded) => {
        const postIds = await insertDatedPosts(serviceClient, seeded, 2);

        await Promise.all(
          postIds.map((postId) =>
            pinNewsPost(seeded.gateways, {
              callerId: seeded.admin.id,
              postId,
              until: null,
              now: new Date(),
            }),
          ),
        );

        await expect(
          readPinnedIds(serviceClient, seeded),
        ).resolves.toHaveLength(1);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "retirar la fijada la desfija, volver a publicarla no la refija, y desfijar deja su rastro",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withSeededClub(serviceClient, async (seeded) => {
        const [postId, otherId] = await insertDatedPosts(
          serviceClient,
          seeded,
          2,
        );
        const admin = { callerId: seeded.admin.id, now: new Date() };
        await pinNewsPost(seeded.gateways, {
          ...admin,
          postId: String(postId),
          until: null,
        });

        await changeNewsPostStatus(seeded.gateways, {
          ...admin,
          postId: String(postId),
          status: "withdrawn",
        });
        const republished = await changeNewsPostStatus(seeded.gateways, {
          ...admin,
          postId: String(postId),
          status: "published",
        });
        await pinNewsPost(seeded.gateways, {
          ...admin,
          postId: String(otherId),
          until: PIN_UNTIL,
        });
        await unpinNewsPost(seeded.gateways, {
          callerId: seeded.admin.id,
          postId: String(otherId),
        });

        expect(republished).toMatchObject({ isPinned: false });
        await expect(readPinnedIds(serviceClient, seeded)).resolves.toEqual([]);
        const actions = await readPinActions(serviceClient, seeded);
        expect(actions.at(-1)).toEqual({
          action: "news_post.unpinned",
          entity_id: otherId,
          metadata: { until: expect.stringMatching(PIN_UNTIL_AS_STORED) },
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "el feed trae la fijada aparte y no la repite ni en la primera página ni en la segunda",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withSeededClub(serviceClient, async (seeded) => {
        const postIds = await insertDatedPosts(serviceClient, seeded, 23);
        const pinnedId = String(postIds[21]);
        await pinNewsPost(seeded.gateways, {
          callerId: seeded.admin.id,
          postId: pinnedId,
          until: PIN_UNTIL,
          now: new Date(),
        });

        const reader = { callerId: seeded.outsider.id, now: new Date() };
        const first = await listNewsFeed(seeded.gateways, reader);
        const second = await listNewsFeed(seeded.gateways, {
          ...reader,
          cursor: String(first.nextCursor),
        });

        expect(first.pinned).toMatchObject({
          id: pinnedId,
          pinnedUntil: expect.stringMatching(PIN_UNTIL_AS_STORED),
        });
        expect(second.pinned).toBeNull();
        const listed = [...first.posts, ...second.posts].map((post) => post.id);
        expect(listed).toEqual(postIds.filter((id) => id !== pinnedId));
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "a quien no es audiencia de la fijada le llega pinned nulo",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withSeededClub(serviceClient, async (seeded) => {
        const post = await publishWithoutAttachments(seeded.gateways, {
          callerId: seeded.admin.id,
          draft: {
            category: "announcement",
            title: "Solo para el grupo",
            body: "Entrenamiento extra.",
            audience: { kind: "groups", groupIds: [seeded.squadId] },
          },
        });
        await pinNewsPost(seeded.gateways, {
          callerId: seeded.admin.id,
          postId: post.id,
          until: null,
          now: new Date(),
        });

        const memberFeed = await listNewsFeed(seeded.gateways, {
          callerId: seeded.squadMember.id,
          now: new Date(),
        });
        const outsiderFeed = await listNewsFeed(seeded.gateways, {
          callerId: seeded.outsider.id,
          now: new Date(),
        });

        expect(memberFeed.pinned?.id).toBe(post.id);
        expect(outsiderFeed).toMatchObject({ pinned: null, posts: [] });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
