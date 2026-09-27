import { expect, it } from "vitest";
import { DEFAULT_CLUB_SLUG } from "@/lib/auth/supabase-auth-gateways";
import {
  NewsAttachmentNotFoundError,
  serveNewsAttachment,
} from "@/lib/news/news-attachments";
import {
  discardNewsUpload,
  publishNewsPostWithUploads,
  stageNewsUpload,
} from "@/lib/news/news-uploads";
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
 * Las subidas previas contra `seadragons-dev` con los adaptadores de verdad
 * (#330). Lo que ningún doble puede decir: que Storage guarda el nombre del
 * archivo en sus metadatos y lo devuelve, que publicar copia el archivo a la
 * carpeta de la publicación y lo sirve, y que quitar una subida la borra.
 *
 * Cada caso borra al terminar las dos carpetas que tocó: la cascada de
 * `news_posts` no alcanza a Storage.
 */

const PDF_BYTES = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n",
);

type Seeded = { readonly clubId: string; readonly committee: TestUser };

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

async function listFolder(
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

async function emptyFolder(
  serviceClient: ServiceRoleClient,
  folder: string,
): Promise<void> {
  const leftovers = await listFolder(serviceClient, folder);
  if (leftovers.length === 0) {
    return;
  }
  const { error } = await serviceClient.client.storage
    .from(NEWS_ATTACHMENTS_BUCKET)
    .remove([...leftovers]);
  if (error) {
    throw new Error(`No se pudo limpiar ${folder}: ${error.message}`);
  }
}

/** Borra las publicaciones de quien publicó con sus carpetas, y después su
 * carpeta de subidas. */
async function cleanUpPublisher(
  serviceClient: ServiceRoleClient,
  seeded: Seeded,
): Promise<void> {
  const { data, error } = await serviceClient.client
    .from("news_posts")
    .delete()
    .eq("author_id", seeded.committee.id)
    .select("id");
  if (error) {
    throw new Error(
      `No se pudieron borrar las publicaciones: ${error.message}`,
    );
  }
  for (const post of data) {
    await emptyFolder(serviceClient, `${seeded.clubId}/${String(post.id)}`);
  }
  await emptyFolder(
    serviceClient,
    `${seeded.clubId}/uploads/${seeded.committee.id}`,
  );
}

async function withCommittee(
  serviceClient: ServiceRoleClient,
  run: (seeded: Seeded) => Promise<void>,
): Promise<void> {
  const clubId = await readClubId(serviceClient);
  await withTestUser(serviceClient, (committee) =>
    withSeededRows(
      serviceClient,
      "members",
      [
        {
          club_id: clubId,
          user_id: committee.id,
          full_name: "Carla Committee",
          email: committee.email,
          account_status: "active",
          role: "Committee",
        },
      ],
      async () => {
        const seeded = { clubId, committee };
        try {
          await run(seeded);
        } finally {
          await cleanUpPublisher(serviceClient, seeded);
        }
      },
    ),
  );
}

describeRls("subidas previas de noticias contra seadragons-dev", () => {
  it(
    "publicar copia la subida a la publicación, la sirve con su nombre y vacía la carpeta de subidas",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createNewsAttachmentGateways(serviceClient.client);

      await withCommittee(serviceClient, async ({ clubId, committee }) => {
        const upload = await stageNewsUpload(gateways, {
          callerId: committee.id,
          fileName: "Acta ñ.pdf",
          bytes: PDF_BYTES,
        });

        const post = await publishNewsPostWithUploads(gateways, {
          callerId: committee.id,
          draft: {
            category: "document",
            title: "Acta de la asamblea",
            body: "Adjunta.",
            audience: { kind: "club" },
          },
          uploadIds: [upload.id],
          now: new Date(),
        });
        const [attachment] = post.attachments;
        if (attachment === undefined) {
          throw new Error("La publicación no trae su adjunto.");
        }
        const download = await serveNewsAttachment(gateways, {
          callerId: committee.id,
          postId: post.id,
          attachmentId: attachment.id,
        });

        expect(attachment).toMatchObject({
          fileName: "Acta ñ.pdf",
          contentType: "application/pdf",
          sizeBytes: PDF_BYTES.length,
        });
        expect(download.status).toBe("available");
        expect(
          await listFolder(serviceClient, `${clubId}/uploads/${committee.id}`),
        ).toEqual([]);
        expect(
          await listFolder(serviceClient, `${clubId}/${post.id}`),
        ).toHaveLength(1);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "quitar una subida la borra del almacenamiento, y una segunda vez ya no existe",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createNewsAttachmentGateways(serviceClient.client);

      await withCommittee(serviceClient, async ({ clubId, committee }) => {
        const upload = await stageNewsUpload(gateways, {
          callerId: committee.id,
          fileName: "acta.pdf",
          bytes: PDF_BYTES,
        });
        const request = { callerId: committee.id, uploadId: upload.id };

        await discardNewsUpload(gateways, request);

        expect(
          await listFolder(serviceClient, `${clubId}/uploads/${committee.id}`),
        ).toEqual([]);
        await expect(
          discardNewsUpload(gateways, request),
        ).rejects.toBeInstanceOf(NewsAttachmentNotFoundError);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
