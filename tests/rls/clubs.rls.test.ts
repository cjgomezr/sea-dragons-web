import { expect, it } from "vitest";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  createRlsClient,
  createServiceRoleTestClient,
  describeRls,
  withTestUser,
} from "../support/rls";

describeRls("clubs", () => {
  it(
    "permite a un usuario autenticado leer el club sembrado por la migración",
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

        const { data, error } = await rlsClient.client
          .from("clubs")
          .select("slug")
          .eq("slug", "victoria-seadragons");

        expect(error).toBeNull();
        expect(data).toEqual([{ slug: "victoria-seadragons" }]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
