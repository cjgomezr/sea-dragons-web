import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { readSessionState } from "@/lib/auth/session-reader";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import {
  type MembershipWaiverGateways,
  removeMembershipWaiver,
  waiveMembership,
} from "@/lib/membership/membership-waiver";
import { createMembershipWaiverWriters } from "@/lib/membership/supabase-membership-waiver-gateways";
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
 * La exención manual del Admin contra `seadragons-dev`, con los adaptadores
 * de verdad y `0054_membership_waiver.sql` aplicada (#457). Lo que ningún
 * doble puede decir: que eximir abre la puerta de socio en la siguiente
 * petición con la misma sesión (la frontera olvida lo que recordaba, #434),
 * que retirarla la cierra, y qué queda en `audit_log`.
 *
 * Todo pasa en un solo test: cada socio de prueba sale de la reserva (#415),
 * y cada comprobación de sesión es un inicio de sesión.
 */

const CLUBS_TABLE = "clubs";
const MEMBERS_TABLE = "members";
const MEMBERSHIPS_TABLE = "memberships";
const AUDIT_LOG_TABLE = "audit_log";

type Role = "Admin" | "Player";

async function withTemporaryClub<T>(
  serviceClient: ServiceRoleClient,
  run: (clubId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    CLUBS_TABLE,
    [{ slug: `exencion-${randomUUID()}`, name: "Club de la exención" }],
    async ([club]) => {
      const clubId = club!.id as string;
      try {
        return await run(clubId);
      } finally {
        const { error } = await serviceClient.client
          .from(AUDIT_LOG_TABLE)
          .delete()
          .eq("club_id", clubId);
        if (error) {
          throw new Error(`No se pudo limpiar la bitácora: ${error.message}`);
        }
      }
    },
  );
}

/** Un socio activo con su membresía pendiente: la puerta de socio cerrada. */
async function withActiveMember<T>(
  serviceClient: ServiceRoleClient,
  seed: { readonly clubId: string; readonly role: Role },
  run: (member: TestUser) => Promise<T>,
): Promise<T> {
  return withTestUser(serviceClient, async (user) => {
    const { error } = await serviceClient.client.from(MEMBERS_TABLE).insert({
      club_id: seed.clubId,
      user_id: user.id,
      full_name: `Socia ${seed.role} de la exención`,
      email: user.email,
      country: "AU",
      date_of_birth: "1994-03-02",
      membership_type: "Full",
      account_status: "active",
      role: seed.role,
    });
    if (error) {
      throw new Error(`No se pudo sembrar el socio: ${error.message}`);
    }
    const { error: membershipError } = await serviceClient.client
      .from(MEMBERSHIPS_TABLE)
      .insert({
        user_id: user.id,
        club_id: seed.clubId,
        plan: "Full",
        status: "pending",
      });
    if (membershipError) {
      throw new Error(
        `No se pudo sembrar la membresía: ${membershipError.message}`,
      );
    }
    return run(user);
  });
}

async function openSessionOf(member: TestUser): Promise<SupabaseClient> {
  const { client } = await createRlsClient(
    { role: "authenticated", email: member.email, password: member.password },
    process.env,
  );
  return client;
}

/** Si la frontera ve al socio al día en su siguiente petición. */
async function isMembershipCurrent(session: SupabaseClient): Promise<boolean> {
  const state = await readSessionState(session);
  if (state.kind !== "active") {
    throw new Error(`La sesión del socio no está activa: ${state.kind}`);
  }
  return state.membershipCurrent;
}

async function readAuditEntries(
  serviceClient: ServiceRoleClient,
  clubId: string,
): Promise<readonly Record<string, unknown>[]> {
  const { data, error } = await serviceClient.client
    .from(AUDIT_LOG_TABLE)
    .select("actor_id, action, entity_type, entity_id, result, metadata")
    .eq("club_id", clubId)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`No se pudo leer la bitácora: ${error.message}`);
  }
  return data;
}

function createGateways(
  serviceClient: ServiceRoleClient,
): MembershipWaiverGateways {
  return {
    members: createRoleRequestGateways(serviceClient.client).members,
    waivers: createMembershipWaiverWriters(serviceClient.client),
    subscriptions: { kind: "unconfigured" },
    audit: createSupabaseAuditLogWriter(serviceClient.client),
    log: (line) => {
      throw new Error(`Nadie tenía suscripción, y se escribió: ${line}`);
    },
  };
}

describeRls("la exención manual contra seadragons-dev", () => {
  it(
    "eximir abre la puerta en la siguiente petición con la misma sesión, retirarla la cierra, y las dos quedan en la bitácora",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createGateways(serviceClient);

      await withTemporaryClub(serviceClient, (clubId) =>
        withActiveMember(serviceClient, { clubId, role: "Admin" }, (admin) =>
          withActiveMember(
            serviceClient,
            { clubId, role: "Player" },
            async (player) => {
              const session = await openSessionOf(player);
              await expect(isMembershipCurrent(session)).resolves.toBe(false);

              const waived = await waiveMembership(gateways, {
                actorId: admin.id,
                targetUserId: player.id,
                submission: { reason: "Entrenadora", until: "2099-03-01" },
                now: new Date(),
              });

              expect(waived).toEqual({
                userId: player.id,
                membershipStatus: "waived",
                waiver: {
                  reason: "Entrenadora",
                  until: "2099-02-28T13:00:00.000Z",
                },
              });
              await expect(isMembershipCurrent(session)).resolves.toBe(true);

              const removed = await removeMembershipWaiver(gateways, {
                actorId: admin.id,
                targetUserId: player.id,
              });

              expect(removed.membershipStatus).toBe("pending");
              await expect(isMembershipCurrent(session)).resolves.toBe(false);
              await expect(
                readAuditEntries(serviceClient, clubId),
              ).resolves.toEqual([
                {
                  actor_id: admin.id,
                  action: "membership.waived",
                  entity_type: "member",
                  entity_id: player.id,
                  result: "success",
                  metadata: {
                    reason: "Entrenadora",
                    until: "2099-02-28T13:00:00.000Z",
                  },
                },
                {
                  actor_id: admin.id,
                  action: "membership.waiver_removed",
                  entity_type: "member",
                  entity_id: player.id,
                  result: "success",
                  metadata: { newStatus: "pending" },
                },
              ]);
            },
          ),
        ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
