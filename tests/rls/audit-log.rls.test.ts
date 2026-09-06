import { it } from "vitest";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  assertDenied,
  createRlsClient,
  createServiceRoleTestClient,
  describeRls,
  withTestUser,
} from "../support/rls";

describeRls("audit_log", () => {
  it(
    "niega a un usuario autenticado sin permiso la lectura de audit_log",
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
          client.from("audit_log").select("*"),
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
