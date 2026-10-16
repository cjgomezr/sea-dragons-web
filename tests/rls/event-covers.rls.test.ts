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
 * Las imágenes de eventos (#644, RF-3 y D7 del PRD de E24). Viven en el
 * bucket privado `event-covers`, que no tiene ninguna policy: un socio no lee
 * el fichero con su propia sesión aunque sepa su ruta, ni la tabla de las
 * subidas. Sólo el servidor las firma, después de comprobar la audiencia.
 */

const BUCKET = "event-covers";
const WEBP_HEADER = Uint8Array.from(Buffer.from("RIFF\0\0\0\0WEBPVP8 "));

async function withStoredCover(
  serviceClient: ServiceRoleClient,
  run: (storagePath: string) => Promise<void>,
): Promise<void> {
  const storagePath = `${randomUUID()}/${randomUUID()}-large.webp`;
  const bucket = serviceClient.client.storage.from(BUCKET);
  const { error } = await bucket.upload(storagePath, WEBP_HEADER, {
    contentType: "image/webp",
  });
  if (error) {
    throw new Error(`No se pudo sembrar la imagen: ${error.message}`);
  }
  try {
    await run(storagePath);
  } finally {
    await bucket.remove([storagePath]);
  }
}

describeRls("event covers", () => {
  it(
    "no deja a un socio descargar el fichero de una imagen con su sesión",
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
    "no deja a un socio leer event_cover_uploads",
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
          client.from("event_cover_uploads").select("*"),
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
