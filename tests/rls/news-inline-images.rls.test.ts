import { it } from "vitest";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  assertDenied,
  createRlsClient,
  createServiceRoleTestClient,
  describeRls,
  withTestUser,
} from "../support/rls";

/**
 * Las imágenes del cuerpo de las publicaciones (#603, RF-14 del PRD de E22).
 * Sus ficheros viven en el bucket privado de los adjuntos, como las
 * portadas, y la tabla que dice de quién es cada una y a qué publicación va
 * no se la deja leer ni escribir a un socio con su sesión: sólo el servidor
 * firma una, después de comprobar la audiencia.
 */

const IMAGE_ID = "1d1d1d1d-0000-4000-8000-0000000000aa";

describeRls("news inline images", () => {
  it(
    "no deja a un socio leer news_inline_images",
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
          client.from("news_inline_images").select("*"),
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "no deja a un socio ligar una imagen con su sesión",
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
          client
            .from("news_inline_images")
            .update({ post_id: null })
            .eq("id", IMAGE_ID)
            .select("id"),
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
