import { setTimeout as sleep } from "node:timers/promises";
import { expect, it } from "vitest";
import { DEFAULT_CLUB_SLUG } from "@/lib/auth/supabase-auth-gateways";
import {
  NEWS_ATTACHMENTS_MAX_PER_POST,
  type NewsAttachmentGateways,
  NewsAttachmentValidationError,
  attachNewsFile,
  removeNewsAttachment,
  serveNewsAttachment,
} from "@/lib/news/news-attachments";
import { type NewsPostDetail, publishNewsPost } from "@/lib/news/news-posts";
import {
  NEWS_ATTACHMENTS_BUCKET,
  createNewsAttachmentGateways,
} from "@/lib/news/supabase-news-attachment-gateways";
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
 * Los adjuntos contra `seadragons-dev` con los adaptadores de verdad (#328).
 * Lo que ningún doble puede decir: que el bucket de
 * `0030_news_attachments.sql` guarda el fichero, que la dirección firmada lo
 * descarga y después caduca, que quitarlo lo borra de Storage, y que el
 * trigger del sexto adjunto llega al dominio con su código.
 *
 * Cada caso borra al terminar la carpeta de su publicación: la cascada de
 * `news_posts` no alcanza a Storage.
 */

const PDF_BYTES = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n",
);

/** Lo justo para firmar, dejar que caduque y comprobarlo sin alargar la
 * corrida. */
const SHORT_URL_LIFETIME_SECONDS = 1;
const EXPIRY_MARGIN_MS = 3_000;

type Seeded = {
  readonly clubId: string;
  readonly committee: TestUser;
  readonly reader: TestUser;
  readonly post: NewsPostDetail;
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
  role: "Committee" | "Player",
): Record<string, unknown> {
  return {
    club_id: clubId,
    user_id: user.id,
    full_name: role === "Committee" ? "Carla Committee" : "Pía Player",
    email: user.email,
    account_status: "active",
    role,
  };
}

async function listPostFolder(
  serviceClient: ServiceRoleClient,
  folder: string,
): Promise<readonly string[]> {
  const { data, error } = await serviceClient.client.storage
    .from(NEWS_ATTACHMENTS_BUCKET)
    .list(folder);
  if (error) {
    throw new Error(`No se pudo listar ${folder}: ${error.message}`);
  }
  return data.map((file) => `${folder}/${file.name}`);
}

/** Borra los ficheros y después la publicación: ni la cascada ni el borrado
 * del socio llegan a Storage, y la clave del autor no deja borrar a quien
 * publicó. */
async function cleanUpPost(
  serviceClient: ServiceRoleClient,
  post: { readonly clubId: string; readonly id: string },
): Promise<void> {
  const leftovers = await listPostFolder(
    serviceClient,
    `${post.clubId}/${post.id}`,
  );
  if (leftovers.length > 0) {
    const removed = await serviceClient.client.storage
      .from(NEWS_ATTACHMENTS_BUCKET)
      .remove([...leftovers]);
    if (removed.error) {
      throw new Error(
        `No se pudo limpiar la carpeta: ${removed.error.message}`,
      );
    }
  }
  const { error } = await serviceClient.client
    .from("news_posts")
    .delete()
    .eq("id", post.id);
  if (error) {
    throw new Error(`No se pudo borrar la publicación: ${error.message}`);
  }
}

/** Un Committee con una publicación para todo el club, y un Player que la
 * lee. Todo se deshace, ficheros incluidos. */
async function withSeededPost(
  serviceClient: ServiceRoleClient,
  gateways: NewsAttachmentGateways,
  run: (seeded: Seeded) => Promise<void>,
): Promise<void> {
  const clubId = await readClubId(serviceClient);
  await withTestUser(serviceClient, (committee) =>
    withTestUser(serviceClient, (reader) =>
      withSeededRows(
        serviceClient,
        "members",
        [
          memberRow(clubId, committee, "Committee"),
          memberRow(clubId, reader, "Player"),
        ],
        async () => {
          const post = await publishNewsPost(gateways, {
            callerId: committee.id,
            draft: {
              category: "document",
              title: "Acta de la asamblea",
              body: "Adjunta.",
              audience: { kind: "club" },
            },
          });
          try {
            await run({ clubId, committee, reader, post });
          } finally {
            await cleanUpPost(serviceClient, { clubId, id: post.id });
          }
        },
      ),
    ),
  );
}

describeRls("adjuntos de noticias contra seadragons-dev", () => {
  it(
    "subir deja el archivo en el bucket, la dirección firmada lo descarga y quitarlo lo borra",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createNewsAttachmentGateways(serviceClient.client);

      await withSeededPost(serviceClient, gateways, async (seeded) => {
        const folder = `${seeded.clubId}/${seeded.post.id}`;
        const attachment = await attachNewsFile(gateways, {
          callerId: seeded.committee.id,
          postId: seeded.post.id,
          fileName: "acta.pdf",
          bytes: PDF_BYTES,
        });
        const stored = await listPostFolder(serviceClient, folder);

        const download = await serveNewsAttachment(gateways, {
          callerId: seeded.reader.id,
          postId: seeded.post.id,
          attachmentId: attachment.id,
        });
        if (download.status !== "available") {
          throw new Error("La dirección firmada no llegó.");
        }
        const response = await fetch(download.url);
        const bytes = new Uint8Array(await response.arrayBuffer());

        await removeNewsAttachment(gateways, {
          callerId: seeded.committee.id,
          postId: seeded.post.id,
          attachmentId: attachment.id,
        });

        expect(stored).toHaveLength(1);
        expect(response.ok).toBe(true);
        expect(Array.from(bytes)).toEqual(Array.from(PDF_BYTES));
        expect(await listPostFolder(serviceClient, folder)).toEqual([]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "una dirección firmada caducada ya no descarga",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createNewsAttachmentGateways(
        serviceClient.client,
        SHORT_URL_LIFETIME_SECONDS,
      );

      await withSeededPost(serviceClient, gateways, async (seeded) => {
        const attachment = await attachNewsFile(gateways, {
          callerId: seeded.committee.id,
          postId: seeded.post.id,
          fileName: "acta.pdf",
          bytes: PDF_BYTES,
        });
        const download = await serveNewsAttachment(gateways, {
          callerId: seeded.reader.id,
          postId: seeded.post.id,
          attachmentId: attachment.id,
        });
        if (download.status !== "available") {
          throw new Error("La dirección firmada no llegó.");
        }

        await sleep(SHORT_URL_LIFETIME_SECONDS * 1_000 + EXPIRY_MARGIN_MS);
        const response = await fetch(download.url);

        expect(response.ok).toBe(false);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un adjunto que ya no está en el almacenamiento se sirve como no disponible",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createNewsAttachmentGateways(serviceClient.client);

      await withSeededPost(serviceClient, gateways, async (seeded) => {
        const attachment = await attachNewsFile(gateways, {
          callerId: seeded.committee.id,
          postId: seeded.post.id,
          fileName: "acta.pdf",
          bytes: PDF_BYTES,
        });
        const folder = `${seeded.clubId}/${seeded.post.id}`;
        await gateways.storage.remove(
          await listPostFolder(serviceClient, folder),
        );

        const download = await serveNewsAttachment(gateways, {
          callerId: seeded.reader.id,
          postId: seeded.post.id,
          attachmentId: attachment.id,
        });

        expect(download).toEqual({
          status: "unavailable",
          fileName: "acta.pdf",
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "la base rechaza el sexto adjunto y llega al dominio con el límite",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createNewsAttachmentGateways(serviceClient.client);

      await withSeededPost(serviceClient, gateways, async (seeded) => {
        const rowFor = (index: number) => ({
          postId: seeded.post.id,
          clubId: seeded.clubId,
          fileName: `acta-${index}.pdf`,
          contentType: "application/pdf" as const,
          sizeBytes: PDF_BYTES.length,
          storagePath: `${seeded.clubId}/${seeded.post.id}/fila-${index}.pdf`,
        });
        for (
          let index = 1;
          index <= NEWS_ATTACHMENTS_MAX_PER_POST;
          index += 1
        ) {
          await gateways.attachments.insertAttachment(rowFor(index));
        }

        const error: unknown = await gateways.attachments
          .insertAttachment(rowFor(NEWS_ATTACHMENTS_MAX_PER_POST + 1))
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(NewsAttachmentValidationError);
        expect((error as NewsAttachmentValidationError).code).toBe(
          "attachment_limit_reached",
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
