import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  assertDenied,
  createRlsClient,
  createServiceRoleTestClient,
  describeRls,
  withTestUser,
} from "../support/rls";

/**
 * Las portadas de las publicaciones (#591, RF-2 del PRD de E22). Viven en el
 * bucket privado de los adjuntos, que no tiene ninguna policy: un socio no
 * lee el fichero de una portada con su propia sesión aunque sepa su ruta, y
 * tampoco la tabla que las apunta. Sólo el servidor las firma, después de
 * comprobar la audiencia.
 */

const BUCKET = "news-attachments";
const WEBP_HEADER = Uint8Array.from(Buffer.from("RIFF\0\0\0\0WEBPVP8 "));

async function withStoredCover(
  serviceClient: ServiceRoleClient,
  run: (storagePath: string) => Promise<void>,
): Promise<void> {
  const storagePath = `${randomUUID()}/covers/${randomUUID()}-large.webp`;
  const bucket = serviceClient.client.storage.from(BUCKET);
  const { error } = await bucket.upload(storagePath, WEBP_HEADER, {
    contentType: "image/webp",
  });
  if (error) {
    throw new Error(`No se pudo sembrar la portada: ${error.message}`);
  }
  try {
    await run(storagePath);
  } finally {
    await bucket.remove([storagePath]);
  }
}

describeRls("news covers", () => {
  it(
    "no deja a un socio descargar el fichero de una portada con su sesión",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withTestUser(serviceClient, (user) =>
        withStoredCover(serviceClient, async (storagePath) => {
          const rlsClient = await createRlsClient(
            {
              role: "authenticated",
              email: user.email,
              password: user.password,
            },
            process.env,
          );

          const { data, error } = await rlsClient.client.storage
            .from(BUCKET)
            .download(storagePath);

          expect(data).toBeNull();
          expect(error).not.toBeNull();
        }),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "no deja a un socio leer news_cover_uploads",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withTestUser(serviceClient, async (user) => {
        const rlsClient = await createRlsClient(
          {
            role: "authenticated",
            email: user.email,
            password: user.password,
          },
          process.env,
        );

        await assertDenied(rlsClient, (client) =>
          client.from("news_cover_uploads").select("*"),
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
