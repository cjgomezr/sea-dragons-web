import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createSupabaseAuthGateways } from "@/lib/auth/supabase-auth-gateways";
import { readSessionState } from "@/lib/auth/session-reader";
import {
  DEFAULT_DIRECTORY_QUERY,
  listDirectory,
} from "@/lib/directory/directory";
import { createDirectoryGateways } from "@/lib/directory/supabase-directory-gateways";
import { createClubPositionsGateway } from "@/lib/club/supabase-club-positions";
import {
  InactiveMemberError,
  assignGroupMember,
} from "@/lib/groups/group-members";
import { createGroupMembersGateways } from "@/lib/groups/supabase-group-members-gateways";
import { createGroupsGateways } from "@/lib/groups/supabase-groups-gateways";
import {
  type MemberStatusChangeGateways,
  changeMemberStatus,
} from "@/lib/members/member-status-change";
import { createMemberStatusWriters } from "@/lib/members/supabase-member-status-gateways";
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
 * La baja y la reactivación de un socio contra `seadragons-dev`, con los
 * adaptadores de verdad y `0017_set_member_status.sql` aplicada. Lo que ningún
 * doble puede decir: que la baja saca al socio del directorio, del conteo de
 * su grupo, de los candidatos a asignar y de la sesión, que la reactivación
 * lo devuelve a todos, que su pertenencia al grupo sobrevive mientras tanto y
 * qué queda en `audit_log`.
 *
 * Todo pasa en un solo test: cada socio de prueba cuesta un usuario real de
 * Supabase Auth, y cada comprobación de sesión, un inicio de sesión.
 */

const CLUBS_TABLE = "clubs";
const MEMBERS_TABLE = "members";
const GROUPS_TABLE = "groups";
const MEMBERSHIPS_TABLE = "group_memberships";
const AUDIT_LOG_TABLE = "audit_log";
const TODAY = "2026-09-22";

type Role = "Admin" | "Player";

type SeededMember = TestUser & { readonly fullName: string };

async function deleteByClub(
  serviceClient: ServiceRoleClient,
  table: string,
  clubId: string,
): Promise<void> {
  const { error } = await serviceClient.client
    .from(table)
    .delete()
    .eq("club_id", clubId);
  if (error) {
    throw new Error(`No se pudo limpiar ${table}: ${error.message}`);
  }
}

/** Un club de usar y tirar. Sus grupos y su bitácora se borran antes que
 * él, que no se puede borrar mientras alguna fila lo nombre. */
async function withTemporaryClub<T>(
  serviceClient: ServiceRoleClient,
  run: (clubId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    CLUBS_TABLE,
    [{ slug: `baja-${randomUUID()}`, name: "Club de la baja" }],
    async ([club]) => {
      const clubId = club!.id as string;
      try {
        return await run(clubId);
      } finally {
        await deleteByClub(serviceClient, GROUPS_TABLE, clubId);
        await deleteByClub(serviceClient, AUDIT_LOG_TABLE, clubId);
      }
    },
  );
}

/** Con el perfil completo (FR-083): así la reactivación vuelve a `active`
 * y no a `incomplete`, que es lo que se quiere ver aquí. */
async function withActiveMember<T>(
  serviceClient: ServiceRoleClient,
  seed: { readonly clubId: string; readonly role: Role },
  run: (member: SeededMember) => Promise<T>,
): Promise<T> {
  const fullName = `Socia ${seed.role} de la baja`;
  return withTestUser(serviceClient, async (user) => {
    const { error } = await serviceClient.client.from(MEMBERS_TABLE).insert({
      club_id: seed.clubId,
      user_id: user.id,
      full_name: fullName,
      email: user.email,
      country: "AU",
      date_of_birth: "1994-03-02",
      membership_type: "Full",
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

async function createGroupWithMember(
  serviceClient: ServiceRoleClient,
  seed: { readonly clubId: string; readonly userId: string },
): Promise<string> {
  const result = await createGroupsGateways(
    serviceClient.client,
  ).groups.insertGroup({ clubId: seed.clubId, name: "Senior Squad" });
  if (result.kind !== "created") {
    throw new Error(`No se pudo crear el grupo: ${result.kind}`);
  }
  const { error } = await serviceClient.client.from(MEMBERSHIPS_TABLE).insert({
    club_id: seed.clubId,
    group_id: result.group.id,
    user_id: seed.userId,
  });
  if (error) {
    throw new Error(`No se pudo asignar al socio: ${error.message}`);
  }
  return result.group.id;
}

async function readMembershipCount(
  serviceClient: ServiceRoleClient,
  groupId: string,
): Promise<number> {
  const { count, error } = await serviceClient.client
    .from(MEMBERSHIPS_TABLE)
    .select("*", { count: "exact", head: true })
    .eq("group_id", groupId);
  if (error) {
    throw new Error(`No se pudo contar la pertenencia: ${error.message}`);
  }
  return count ?? 0;
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

/** Lo que la frontera ve en la siguiente petición del socio, leído con su
 * propia sesión como lo lee el proxy. */
async function sessionOf(member: SeededMember): Promise<string> {
  const { client } = await createRlsClient(
    { role: "authenticated", email: member.email, password: member.password },
    process.env,
  );
  return (await readSessionState(client)).kind;
}

function requireGateways(
  serviceClient: ServiceRoleClient,
): MemberStatusChangeGateways {
  const authWiring = createSupabaseAuthGateways(process.env);
  if (authWiring.kind === "unconfigured") {
    throw new Error(
      `Faltan variables para reactivar: ${authWiring.missingKeys.join(", ")}`,
    );
  }
  return {
    ...createMemberStatusWriters(serviceClient.client),
    accounts: authWiring.gateways.accounts,
    identities: authWiring.gateways.identities,
  };
}

describeRls("la baja y la reactivación contra seadragons-dev", () => {
  it(
    "la baja saca al socio del directorio, del conteo y de la sesión, la reactivación lo devuelve, y las dos quedan en la bitácora",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = requireGateways(serviceClient);
      const directory = createDirectoryGateways(
  serviceClient.client,
  createClubPositionsGateway(serviceClient.client),
);
      const groups = createGroupsGateways(serviceClient.client);
      const groupMembers = createGroupMembersGateways(serviceClient.client);

      await withTemporaryClub(serviceClient, (clubId) =>
        withActiveMember(serviceClient, { clubId, role: "Admin" }, (admin) =>
          withActiveMember(
            serviceClient,
            { clubId, role: "Player" },
            async (player) => {
              const groupId = await createGroupWithMember(serviceClient, {
                clubId,
                userId: player.id,
              });
              const directoryNames = async (includeInactive = false) => {
                const listing = await listDirectory(directory, {
                  callerId: admin.id,
                  query: { ...DEFAULT_DIRECTORY_QUERY, includeInactive },
                  todayInClub: TODAY,
                });
                return listing.members.map((member) => [
                  member.fullName,
                  member.status,
                ]);
              };
              const groupCount = async () =>
                (await groups.groups.findClubGroups(clubId))[0]?.memberCount;

              await expect(sessionOf(player)).resolves.toBe("active");
              await expect(groupCount()).resolves.toBe(1);

              const deactivated = await changeMemberStatus(gateways, {
                actorId: admin.id,
                targetUserId: player.id,
                status: "inactive",
              });

              expect(deactivated).toEqual({
                userId: player.id,
                previousStatus: "active",
                status: "inactive",
              });
              await expect(sessionOf(player)).resolves.toBe("anonymous");
              await expect(directoryNames()).resolves.toEqual([
                [admin.fullName, "active"],
              ]);
              await expect(directoryNames(true)).resolves.toEqual([
                [admin.fullName, "active"],
                [player.fullName, "inactive"],
              ]);
              await expect(groupCount()).resolves.toBe(0);
              // Sigue asignado: la baja no borra el historial.
              await expect(
                readMembershipCount(serviceClient, groupId),
              ).resolves.toBe(1);
              await expect(
                assignGroupMember(groupMembers, {
                  callerId: admin.id,
                  groupId,
                  userId: player.id,
                }),
              ).rejects.toBeInstanceOf(InactiveMemberError);

              const reactivated = await changeMemberStatus(gateways, {
                actorId: admin.id,
                targetUserId: player.id,
                status: "active",
              });

              expect(reactivated).toEqual({
                userId: player.id,
                previousStatus: "inactive",
                status: "active",
              });
              await expect(sessionOf(player)).resolves.toBe("active");
              await expect(directoryNames()).resolves.toEqual([
                [admin.fullName, "active"],
                [player.fullName, "active"],
              ]);
              await expect(groupCount()).resolves.toBe(1);

              const entries = await readAuditEntries(serviceClient, clubId);
              expect(entries).toEqual([
                {
                  actor_id: admin.id,
                  action: "member.status_changed",
                  entity_type: "member",
                  entity_id: player.id,
                  result: "success",
                  metadata: { previousStatus: "active", newStatus: "inactive" },
                },
                {
                  actor_id: admin.id,
                  action: "member.status_changed",
                  entity_type: "member",
                  entity_id: player.id,
                  result: "success",
                  metadata: { previousStatus: "inactive", newStatus: "active" },
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
    "el último Admin no se puede dar de baja, y el intento queda en la bitácora como fallo",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = requireGateways(serviceClient);

      await withTemporaryClub(serviceClient, (clubId) =>
        withActiveMember(serviceClient, { clubId, role: "Admin" }, (first) =>
          withActiveMember(
            serviceClient,
            { clubId, role: "Admin" },
            async (second) => {
              await changeMemberStatus(gateways, {
                actorId: first.id,
                targetUserId: second.id,
                status: "inactive",
              });

              await expect(
                changeMemberStatus(gateways, {
                  actorId: first.id,
                  targetUserId: first.id,
                  status: "inactive",
                }),
              ).rejects.toMatchObject({ name: "LastAdminDeactivationError" });

              const entries = await readAuditEntries(serviceClient, clubId);
              expect(entries.map((entry) => entry.result)).toEqual([
                "success",
                "failure",
              ]);
              expect(entries[1]).toMatchObject({
                entity_id: first.id,
                metadata: {
                  previousStatus: "active",
                  newStatus: "inactive",
                  reason: "last_admin",
                },
              });
            },
          ),
        ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
