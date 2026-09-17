import { expect, it } from "vitest";
import {
  PendingRoleRequestError,
  describeRoleRequestAccount,
  requestRole,
} from "@/lib/auth/role-request";
import { DEFAULT_CLUB_SLUG } from "@/lib/auth/supabase-auth-gateways";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  createServiceRoleTestClient,
  describeRls,
  withTestUser,
} from "../../support/rls";

/**
 * Las solicitudes de rol contra `seadragons-dev` con los adaptadores de
 * verdad. Lo que ningún doble puede decir: que el choque con el índice único
 * de `0012_role_requests.sql` llega como conflicto y no como un 500, y que la
 * base se queda con una sola pendiente aunque dos envíos lleguen a la vez.
 */

const MEMBERS_TABLE = "members";
const ROLE_REQUESTS_TABLE = "role_requests";

/** Cuántos envíos simultáneos del mismo socio se lanzan. Con dos basta para
 * que los dos pasen la comprobación previa; alguno más hace el choque seguro
 * aunque la red serialice alguna pareja. */
const SIMULTANEOUS_SUBMISSIONS = 4;

async function withActiveMember<T>(
  serviceClient: ServiceRoleClient,
  run: (userId: string) => Promise<T>,
): Promise<T> {
  const { data: club, error: clubError } = await serviceClient.client
    .from("clubs")
    .select("id")
    .eq("slug", DEFAULT_CLUB_SLUG)
    .single();
  if (clubError || !club) {
    throw new Error(
      `No se pudo leer el club sembrado: ${clubError?.message ?? "sin datos"}`,
    );
  }

  return withTestUser(serviceClient, async (user) => {
    const { error } = await serviceClient.client.from(MEMBERS_TABLE).insert({
      club_id: club.id,
      user_id: user.id,
      full_name: "Socia que pide rol",
      email: user.email,
      account_status: "active",
    });
    if (error) {
      throw new Error(`No se pudo sembrar la socia: ${error.message}`);
    }
    // La fila y sus solicitudes se van con la identidad por las cascadas de
    // 0003 y 0012.
    return run(user.id);
  });
}

async function countPending(
  serviceClient: ServiceRoleClient,
  userId: string,
): Promise<number> {
  const { count, error } = await serviceClient.client
    .from(ROLE_REQUESTS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "pending");
  if (error || count === null) {
    throw new Error(
      `No se pudieron contar las pendientes: ${error?.message ?? "sin cuenta"}`,
    );
  }
  return count;
}

describeRls("solicitudes de rol contra seadragons-dev", () => {
  it(
    "guarda la solicitud pendiente y Mi cuenta la lee como la última",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createRoleRequestGateways(serviceClient.client);

      await withActiveMember(serviceClient, async (userId) => {
        const created = await requestRole(gateways, {
          userId,
          requestedRole: "Coach",
          justification: "Entreno a los juveniles.",
        });

        expect(created).toMatchObject({
          requestedRole: "Coach",
          status: "pending",
        });
        await expect(
          describeRoleRequestAccount(gateways, userId),
        ).resolves.toEqual({
          fullName: "Socia que pide rol",
          role: "Player",
          latestRequest: created,
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "deja una sola pendiente cuando llegan varios envíos a la vez",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createRoleRequestGateways(serviceClient.client);

      await withActiveMember(serviceClient, async (userId) => {
        const outcomes = await Promise.allSettled(
          Array.from({ length: SIMULTANEOUS_SUBMISSIONS }, () =>
            requestRole(gateways, {
              userId,
              requestedRole: "Committee",
              justification: null,
            }),
          ),
        );

        const fulfilled = outcomes.filter(
          (outcome) => outcome.status === "fulfilled",
        );
        const rejectedReasons = outcomes.flatMap((outcome) =>
          outcome.status === "rejected" ? [outcome.reason] : [],
        );
        expect(fulfilled).toHaveLength(1);
        for (const reason of rejectedReasons) {
          expect(reason).toBeInstanceOf(PendingRoleRequestError);
        }
        expect(await countPending(serviceClient, userId)).toBe(1);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
