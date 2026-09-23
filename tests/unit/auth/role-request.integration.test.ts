import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { AccountStatus } from "@/lib/auth/account-status";
import {
  PendingRoleRequestError,
  describeRoleRequestAccount,
  requestRole,
} from "@/lib/auth/role-request";
import type { Role } from "@/lib/auth/roles";
import { DEFAULT_CLUB_SLUG } from "@/lib/auth/supabase-auth-gateways";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { createNotificationMarker } from "@/lib/notifications/supabase-notification-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
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
const CLUBS_TABLE = "clubs";
const NOTIFICATIONS_TABLE = "notifications";
const REQUESTER_NAME = "Socia que pide rol";

/** Cuántos envíos simultáneos del mismo socio se lanzan. Con dos basta para
 * que los dos pasen la comprobación previa; alguno más hace el choque seguro
 * aunque la red serialice alguna pareja. */
const SIMULTANEOUS_SUBMISSIONS = 4;

type SeededMember = { readonly userId: string; readonly clubId: string };

async function withActiveMember<T>(
  serviceClient: ServiceRoleClient,
  run: (member: SeededMember) => Promise<T>,
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

  return withClubMember(serviceClient, { clubId: club.id as string }, run);
}

type MemberSeed = {
  readonly clubId: string;
  readonly role?: Role;
  readonly accountStatus?: AccountStatus;
};

async function withClubMember<T>(
  serviceClient: ServiceRoleClient,
  seed: MemberSeed,
  run: (member: SeededMember) => Promise<T>,
): Promise<T> {
  return withTestUser(serviceClient, async (user) => {
    const { error } = await serviceClient.client.from(MEMBERS_TABLE).insert({
      club_id: seed.clubId,
      user_id: user.id,
      full_name: REQUESTER_NAME,
      email: user.email,
      account_status: seed.accountStatus ?? "active",
      role: seed.role ?? "Player",
    });
    if (error) {
      throw new Error(`No se pudo sembrar la socia: ${error.message}`);
    }
    // La fila, sus solicitudes y sus avisos se van con la identidad por las
    // cascadas de 0003, 0012 y 0019.
    return run({ userId: user.id, clubId: seed.clubId });
  });
}

/** Un club de usar y tirar: en el sembrado habría otros Admin a los que el
 * test llenaría de avisos. */
async function withTemporaryClub<T>(
  serviceClient: ServiceRoleClient,
  run: (clubId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    CLUBS_TABLE,
    [{ slug: `aviso-de-solicitud-${randomUUID()}`, name: "Club del aviso" }],
    ([club]) => run(club!.id as string),
  );
}

async function readNotifications(
  serviceClient: ServiceRoleClient,
  userId: string,
): Promise<readonly Record<string, unknown>[]> {
  const { data, error } = await serviceClient.client
    .from(NOTIFICATIONS_TABLE)
    .select("id, club_id, type, data, read_at")
    .eq("user_id", userId);
  if (error) {
    throw new Error(`No se pudieron leer los avisos: ${error.message}`);
  }
  return data;
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

      await withActiveMember(serviceClient, async ({ userId }) => {
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
    "deja un aviso propio a cada Admin activo del club y ninguno al dado de baja (#268)",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createRoleRequestGateways(serviceClient.client);
      const marker = createNotificationMarker(serviceClient.client);
      const admin = { role: "Admin" } as const;

      await withTemporaryClub(serviceClient, (clubId) =>
        withClubMember(serviceClient, { clubId, ...admin }, (first) =>
          withClubMember(serviceClient, { clubId, ...admin }, (second) =>
            withClubMember(
              serviceClient,
              { clubId, ...admin, accountStatus: "inactive" },
              (inactive) =>
                withClubMember(serviceClient, { clubId }, async (player) => {
                  await requestRole(gateways, {
                    userId: player.userId,
                    requestedRole: "Committee",
                    justification: "Llevo la tesorería.",
                  });

                  const expected = {
                    club_id: clubId,
                    type: "role_request_received",
                    data: {
                      requesterName: REQUESTER_NAME,
                      requestedRole: "Committee",
                    },
                    read_at: null,
                  };
                  const [firstNotice] = await readNotifications(
                    serviceClient,
                    first.userId,
                  );
                  expect(firstNotice).toMatchObject(expected);
                  await expect(
                    readNotifications(serviceClient, second.userId),
                  ).resolves.toEqual([expect.objectContaining(expected)]);
                  await expect(
                    readNotifications(serviceClient, inactive.userId),
                  ).resolves.toEqual([]);

                  await marker.markRead({
                    userId: first.userId,
                    notificationId: firstNotice!.id as string,
                  });
                  await expect(
                    readNotifications(serviceClient, second.userId),
                  ).resolves.toEqual([
                    expect.objectContaining({ read_at: null }),
                  ]);
                }),
            ),
          ),
        ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  // Determinista, a diferencia del de envíos simultáneos: si la red los
  // serializa, todos se rechazan en la comprobación previa y el choque con el
  // índice no llega a ocurrir.
  it(
    "convierte el choque con el índice único en pending_exists",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createRoleRequestGateways(serviceClient.client);

      await withActiveMember(serviceClient, async ({ userId, clubId }) => {
        const request = {
          clubId,
          userId,
          requestedRole: "Coach",
          justification: null,
        } as const;
        await expect(
          gateways.requests.insertPendingRequest(request),
        ).resolves.toMatchObject({ kind: "created" });

        await expect(
          gateways.requests.insertPendingRequest(request),
        ).resolves.toEqual({ kind: "pending_exists" });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "deja una sola pendiente cuando llegan varios envíos a la vez",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createRoleRequestGateways(serviceClient.client);

      await withActiveMember(serviceClient, async ({ userId }) => {
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
