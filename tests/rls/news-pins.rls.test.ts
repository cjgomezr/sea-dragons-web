import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  assertDenied,
  createRlsClient,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
  withTestUser,
} from "../support/rls";

/**
 * Fijar una publicación (#592, RF-3 del PRD de E22). Solo el Admin fija
 * (D1), y lo hace por el servidor. Un Committee que llama a la base con su
 * propia sesión no puede escribir las columnas del fijado ni llamar a las
 * funciones que fijan, aunque sea quien publicó la publicación.
 */

type SeededPost = { readonly postId: string };

/** Un club desechable con el usuario de prueba como Committee y una
 * publicación suya. Todo se deshace. */
function withCommitteePost(
  serviceClient: ServiceRoleClient,
  user: TestUser,
  run: (seeded: SeededPost) => Promise<void>,
): Promise<void> {
  return withSeededRows(
    serviceClient,
    "clubs",
    [{ slug: `fijar-${randomUUID()}`, name: "Club de las fijadas" }],
    ([club]) =>
      withSeededRows(
        serviceClient,
        "members",
        [
          {
            club_id: club?.id,
            user_id: user.id,
            full_name: "Carla Committee",
            email: user.email,
            account_status: "active",
            role: "Committee",
          },
        ],
        () =>
          withSeededRows(
            serviceClient,
            "news_posts",
            [
              {
                club_id: club?.id,
                author_id: user.id,
                category: "announcement",
                title: "Cierre de inscripciones",
                body: "Hasta el viernes.",
                audience: "club",
              },
            ],
            ([post]) => run({ postId: String(post?.id) }),
          ),
      ),
  );
}

async function readPinnedAt(
  serviceClient: ServiceRoleClient,
  postId: string,
): Promise<unknown> {
  const { data, error } = await serviceClient.client
    .from("news_posts")
    .select("pinned_at")
    .eq("id", postId)
    .single();
  if (error) {
    throw new Error(`No se pudo leer la publicación: ${error.message}`);
  }
  return data.pinned_at;
}

describeRls("news pins", () => {
  it(
    "no deja a un Committee escribir las columnas del fijado con su sesión",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withTestUser(serviceClient, (user) =>
        withCommitteePost(serviceClient, user, async ({ postId }) => {
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
              .from("news_posts")
              .update({ pinned_at: new Date().toISOString() })
              .eq("id", postId)
              .select("id"),
          );

          await expect(readPinnedAt(serviceClient, postId)).resolves.toBeNull();
        }),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "no deja a un Committee llamar a la función de fijar con su sesión",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withTestUser(serviceClient, (user) =>
        withCommitteePost(serviceClient, user, async ({ postId }) => {
          const rlsClient = await createRlsClient(
            {
              role: "authenticated",
              email: user.email,
              password: user.password,
            },
            process.env,
          );

          await assertDenied(rlsClient, (client) =>
            client.rpc("pin_news_post", {
              acting_club_id: randomUUID(),
              acting_user_id: user.id,
              target_post_id: postId,
              pin_until: null,
            }),
          );

          await expect(readPinnedAt(serviceClient, postId)).resolves.toBeNull();
        }),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
