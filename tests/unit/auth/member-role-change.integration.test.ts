import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  LastAdminError,
  changeMemberRole,
} from "@/lib/auth/member-role-change";
import type { Role } from "@/lib/auth/roles";
import { MEMBER_ROLE_API_PATH } from "@/lib/auth/routes";
import {
  type SessionState,
  decideSessionBoundary,
} from "@/lib/auth/session-boundary";
import { readSessionState } from "@/lib/auth/session-reader";
import { createMemberRoleGateways } from "@/lib/auth/supabase-member-role-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createRlsClient,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
  withTestUser,
} from "../../support/rls";

/**
 * Cambiar el rol de un socio contra `seadragons-dev` con los adaptadores de
 * verdad y `0014_change_member_role.sql` aplicada. Lo que ningún doble puede
 * decir: que la siguiente petición del socio ya pasa la frontera con su rol
 * nuevo, que dos degradaciones a la vez dejan un Admin, y qué queda en
 * `audit_log`.
 *
 * Cada caso corre en un club propio y desechable: contar Admin en el club
 * sembrado dependería de quién más haya en `seadragons-dev`.
 */

const MEMBERS_TABLE = "members";
const AUDIT_LOG_TABLE = "audit_log";
const CLUBS_TABLE = "clubs";
const NOTIFICATIONS_TABLE = "notifications";

type SeededMember = TestUser & { readonly fullName: string };

async function deleteAuditEntries(
  serviceClient: ServiceRoleClient,
  clubId: string,
): Promise<void> {
  const { error } = await serviceClient.client
    .from(AUDIT_LOG_TABLE)
    .delete()
    .eq("club_id", clubId);
  if (error) {
    throw new Error(`No se pudo limpiar la bitácora: ${error.message}`);
  }
}

/** Un club de usar y tirar. Su bitácora se borra antes que el club, que no
 * se puede borrar mientras alguna entrada lo nombre. */
async function withTemporaryClub<T>(
  serviceClient: ServiceRoleClient,
  run: (clubId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    CLUBS_TABLE,
    [{ slug: `cambio-de-rol-${randomUUID()}`, name: "Club del cambio de rol" }],
    async ([club]) => {
      const clubId = club!.id as string;
      try {
        return await run(clubId);
      } finally {
        await deleteAuditEntries(serviceClient, clubId);
      }
    },
  );
}

async function withActiveMember<T>(
  serviceClient: ServiceRoleClient,
  seed: { readonly clubId: string; readonly role: Role },
  run: (member: SeededMember) => Promise<T>,
): Promise<T> {
  const fullName = `Socia ${seed.role} de prueba`;
  return withTestUser(serviceClient, async (user) => {
    const { error } = await serviceClient.client.from(MEMBERS_TABLE).insert({
      club_id: seed.clubId,
      user_id: user.id,
      full_name: fullName,
      email: user.email,
      account_status: "active",
      role: seed.role,
    });
    if (error) {
      throw new Error(
        `No se pudo sembrar el socio ${seed.role}: ${error.message}`,
      );
    }
    return run({ ...user, fullName });
  });
}

async function readRole(
  serviceClient: ServiceRoleClient,
  userId: string,
): Promise<string> {
  const { data, error } = await serviceClient.client
    .from(MEMBERS_TABLE)
    .select("role")
    .eq("user_id", userId)
    .single();
  if (error) {
    throw new Error(`No se pudo leer el rol: ${error.message}`);
  }
  return data.role as string;
}

async function readAuditEntries(
  serviceClient: ServiceRoleClient,
  clubId: string,
): Promise<readonly Record<string, unknown>[]> {
  const { data, error } = await serviceClient.client
    .from(AUDIT_LOG_TABLE)
    .select("actor_id, action, entity_type, entity_id, result, metadata")
    .eq("club_id", clubId);
  if (error) {
    throw new Error(`No se pudo leer la bitácora: ${error.message}`);
  }
  return data;
}

async function readNotifications(
  serviceClient: ServiceRoleClient,
  userId: string,
): Promise<readonly Record<string, unknown>[]> {
  const { data, error } = await serviceClient.client
    .from(NOTIFICATIONS_TABLE)
    .select("club_id, type, data")
    .eq("user_id", userId);
  if (error) {
    throw new Error(`No se pudieron leer los avisos: ${error.message}`);
  }
  return data;
}

/** El rol con el que la frontera ve la siguiente petición del socio, leído
 * con su propia sesión como lo lee el proxy. */
async function sessionRoleOf(member: SeededMember): Promise<SessionState> {
  const { client } = await createRlsClient(
    { role: "authenticated", email: member.email, password: member.password },
    process.env,
  );
  return readSessionState(client);
}

describeRls("cambiar el rol de un socio contra seadragons-dev", () => {
  it(
    "un Player que pasa a Committee entra con ese rol en su siguiente petición, y queda en la bitácora",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createMemberRoleGateways(serviceClient.client);

      await withTemporaryClub(serviceClient, (clubId) =>
        withActiveMember(serviceClient, { clubId, role: "Admin" }, (admin) =>
          withActiveMember(
            serviceClient,
            { clubId, role: "Player" },
            async (player) => {
              await expect(sessionRoleOf(player)).resolves.toEqual({
                kind: "active",
                role: "Player",
              });

              const result = await changeMemberRole(gateways, {
                actorId: admin.id,
                targetUserId: player.id,
                newRole: "Committee",
              });

              expect(result).toEqual({
                userId: player.id,
                previousRole: "Player",
                role: "Committee",
              });
              await expect(sessionRoleOf(player)).resolves.toEqual({
                kind: "active",
                role: "Committee",
              });
              const entries = await readAuditEntries(serviceClient, clubId);
              expect(entries).toEqual([
                {
                  actor_id: admin.id,
                  action: "role.changed",
                  entity_type: "member",
                  entity_id: player.id,
                  result: "success",
                  metadata: { previousRole: "Player", newRole: "Committee" },
                },
              ]);
              const written = JSON.stringify(entries);
              expect(written).not.toContain(player.fullName);
              expect(written).not.toContain(player.email);
            },
          ),
        ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "el socio al que le cambian el rol recibe un aviso con su rol nuevo (#267)",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createMemberRoleGateways(serviceClient.client);

      await withTemporaryClub(serviceClient, (clubId) =>
        withActiveMember(serviceClient, { clubId, role: "Admin" }, (admin) =>
          withActiveMember(
            serviceClient,
            { clubId, role: "Player" },
            async (player) => {
              await changeMemberRole(gateways, {
                actorId: admin.id,
                targetUserId: player.id,
                newRole: "Coach",
              });

              await expect(
                readNotifications(serviceClient, player.id),
              ).resolves.toEqual([
                {
                  club_id: clubId,
                  type: "role_changed",
                  data: { newRole: "Coach" },
                },
              ]);
            },
          ),
        ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "quien pasa a Admin cruza en su siguiente petición la frontera que antes lo paraba",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createMemberRoleGateways(serviceClient.client);

      await withTemporaryClub(serviceClient, (clubId) =>
        withActiveMember(serviceClient, { clubId, role: "Admin" }, (admin) =>
          withActiveMember(
            serviceClient,
            { clubId, role: "Coach" },
            async (coach) => {
              const pathname = MEMBER_ROLE_API_PATH.replace("[id]", admin.id);
              const decideFor = async () =>
                decideSessionBoundary({
                  pathname,
                  session: await sessionRoleOf(coach),
                });
              await expect(decideFor()).resolves.toEqual({
                kind: "missingCapability",
              });

              await changeMemberRole(gateways, {
                actorId: admin.id,
                targetUserId: coach.id,
                newRole: "Admin",
              });

              await expect(decideFor()).resolves.toEqual({ kind: "allow" });
            },
          ),
        ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "dos Admin que se degradan a la vez dejan un Admin, y el rechazo queda como fallo",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createMemberRoleGateways(serviceClient.client);

      await withTemporaryClub(serviceClient, (clubId) =>
        withActiveMember(serviceClient, { clubId, role: "Admin" }, (first) =>
          withActiveMember(
            serviceClient,
            { clubId, role: "Admin" },
            async (second) => {
              // Cada uno se degrada a sí mismo, y no el uno al otro: así
              // quien pierde la carrera sigue siendo Admin cuando el dominio
              // lo comprueba, y el rechazo lo da siempre la base. Cruzadas, la
              // segunda podría llegar tarde a esa lectura y salir con 403; ese
              // caso lo prueba el test de la migración contra Postgres.
              const outcomes = await Promise.allSettled([
                changeMemberRole(gateways, {
                  actorId: first.id,
                  targetUserId: first.id,
                  newRole: "Player",
                }),
                changeMemberRole(gateways, {
                  actorId: second.id,
                  targetUserId: second.id,
                  newRole: "Player",
                }),
              ]);

              const refused = outcomes.flatMap((outcome) =>
                outcome.status === "rejected" ? [outcome.reason] : [],
              );
              expect(refused).toHaveLength(1);
              expect(refused[0]).toBeInstanceOf(LastAdminError);
              const roles = await Promise.all([
                readRole(serviceClient, first.id),
                readRole(serviceClient, second.id),
              ]);
              expect([...roles].sort()).toEqual(["Admin", "Player"]);
              const results = (await readAuditEntries(serviceClient, clubId))
                .map((entry) => entry.result)
                .sort();
              expect(results).toEqual(["failure", "success"]);
            },
          ),
        ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
