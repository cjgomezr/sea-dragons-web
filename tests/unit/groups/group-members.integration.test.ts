import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { GroupMembersGateways } from "@/lib/groups/group-members";
import { createGroupMembersGateways } from "@/lib/groups/supabase-group-members-gateways";
import { createGroupsGateways } from "@/lib/groups/supabase-groups-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
  withTestUser,
} from "../../support/rls";

/**
 * Los adaptadores de los socios de un grupo contra `seadragons-dev` (#227).
 * Van con la llave de servicio, así que lo único que separa un club de otro es
 * el filtro del adaptador y las claves foráneas compuestas de `0015_groups.sql`.
 * Aquí se ve lo que ningún doble puede afirmar: que asignar a dos grupos y
 * quitar de uno mueve los conteos como pide AC-049, y que asignar dos veces no
 * duplica la fila.
 *
 * Orden de limpieza: los grupos se borran primero (y con ellos sus
 * pertenencias), luego los socios y al final los clubes.
 */

const CLUBS_TABLE = "clubs";
const MEMBERS_TABLE = "members";
const GROUPS_TABLE = "groups";

type SeedMember = {
  readonly clubId: string;
  readonly fullName: string;
  readonly accountStatus: AccountStatus;
};

async function withTwoClubs<T>(
  serviceClient: ServiceRoleClient,
  run: (clubIds: readonly [string, string]) => Promise<T>,
): Promise<T> {
  const club = (name: string) => ({
    slug: `socios-grupo-${randomUUID()}`,
    name,
  });
  return withSeededRows(
    serviceClient,
    CLUBS_TABLE,
    [club("Club de los socios"), club("Club vecino")],
    ([own, other]) => run([own!.id as string, other!.id as string]),
  );
}

async function withMember<T>(
  serviceClient: ServiceRoleClient,
  seed: SeedMember,
  run: (member: TestUser) => Promise<T>,
): Promise<T> {
  return withTestUser(serviceClient, async (user) => {
    const { error } = await serviceClient.client.from(MEMBERS_TABLE).insert({
      club_id: seed.clubId,
      user_id: user.id,
      full_name: seed.fullName,
      email: user.email,
      account_status: seed.accountStatus,
      role: "Player",
    });
    if (error) {
      throw new Error(`No se pudo sembrar al socio: ${error.message}`);
    }
    return run(user);
  });
}

async function withMembers<T>(
  serviceClient: ServiceRoleClient,
  seeds: readonly SeedMember[],
  run: (members: readonly TestUser[]) => Promise<T>,
): Promise<T> {
  const [first, ...rest] = seeds;
  if (first === undefined) {
    return run([]);
  }
  return withMember(serviceClient, first, (member) =>
    withMembers(serviceClient, rest, (others) => run([member, ...others])),
  );
}

type SeededGroups = {
  readonly seniorId: string;
  readonly mastersId: string;
  readonly otherClubGroupId: string;
};

async function withGroups<T>(
  serviceClient: ServiceRoleClient,
  clubIds: readonly [string, string],
  run: (groups: SeededGroups) => Promise<T>,
): Promise<T> {
  const [clubId, otherClubId] = clubIds;
  return withSeededRows(
    serviceClient,
    GROUPS_TABLE,
    [
      { club_id: clubId, name: "Senior Squad" },
      { club_id: clubId, name: "Masters Squad" },
      { club_id: otherClubId, name: "Senior Squad" },
    ],
    ([senior, masters, otherClubGroup]) =>
      run({
        seniorId: senior!.id as string,
        mastersId: masters!.id as string,
        otherClubGroupId: otherClubGroup!.id as string,
      }),
  );
}

async function readCounts(
  serviceClient: ServiceRoleClient,
  clubId: string,
): Promise<Record<string, number>> {
  const groups = await createGroupsGateways(
    serviceClient.client,
  ).groups.findClubGroups(clubId);
  return Object.fromEntries(
    groups.map((group) => [group.name, group.memberCount]),
  );
}

describeRls("los socios de un grupo contra seadragons-dev", () => {
  it(
    "asignar a dos grupos y quitar de uno mueve los conteos como pide AC-049",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways: GroupMembersGateways = createGroupMembersGateways(
        serviceClient.client,
      );

      await withTwoClubs(serviceClient, ([clubId, otherClubId]) =>
        withMembers(
          serviceClient,
          [{ clubId, fullName: "paula Player", accountStatus: "active" }],
          ([paula]) =>
            withGroups(
              serviceClient,
              [clubId, otherClubId],
              async ({ seniorId, mastersId }) => {
                const paulaId = paula!.id;
                await expect(
                  readCounts(serviceClient, clubId),
                ).resolves.toEqual({ "Senior Squad": 0, "Masters Squad": 0 });

                for (const groupId of [seniorId, mastersId]) {
                  await expect(
                    gateways.groupMembers.insertMembership({
                      clubId,
                      groupId,
                      userId: paulaId,
                    }),
                  ).resolves.toEqual({ kind: "assigned" });
                }
                // Asignar otra vez no duplica ni falla.
                await expect(
                  gateways.groupMembers.insertMembership({
                    clubId,
                    groupId: seniorId,
                    userId: paulaId,
                  }),
                ).resolves.toEqual({ kind: "assigned" });

                const paulaInList = {
                  kind: "found",
                  members: [{ id: paulaId, fullName: "paula Player" }],
                };
                for (const groupId of [seniorId, mastersId]) {
                  await expect(
                    gateways.groupMembers.findGroupMembers({ clubId, groupId }),
                  ).resolves.toEqual(paulaInList);
                }
                await expect(
                  readCounts(serviceClient, clubId),
                ).resolves.toEqual({ "Senior Squad": 1, "Masters Squad": 1 });

                await expect(
                  gateways.groupMembers.deleteMembership({
                    clubId,
                    groupId: mastersId,
                    userId: paulaId,
                  }),
                ).resolves.toEqual({ kind: "removed" });
                await expect(
                  readCounts(serviceClient, clubId),
                ).resolves.toEqual({ "Senior Squad": 1, "Masters Squad": 0 });

                // Quitar a quien ya no estaba tampoco es un error.
                await expect(
                  gateways.groupMembers.deleteMembership({
                    clubId,
                    groupId: mastersId,
                    userId: paulaId,
                  }),
                ).resolves.toEqual({ kind: "removed" });
              },
            ),
        ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "los candidatos excluyen a los asignados, a los inactive y a los de otro club, en orden alfabético",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createGroupMembersGateways(serviceClient.client);

      await withTwoClubs(serviceClient, ([clubId, otherClubId]) =>
        withMembers(
          serviceClient,
          [
            { clubId, fullName: "Zoe Assigned", accountStatus: "active" },
            {
              clubId,
              fullName: "ivan Incomplete",
              accountStatus: "incomplete",
            },
            { clubId, fullName: "Ana Active", accountStatus: "active" },
            { clubId, fullName: "Bea Inactive", accountStatus: "inactive" },
            {
              clubId: otherClubId,
              fullName: "Otto Neighbour",
              accountStatus: "active",
            },
          ],
          ([assigned, incomplete, active, inactive]) =>
            withGroups(
              serviceClient,
              [clubId, otherClubId],
              async ({ seniorId }) => {
                for (const member of [assigned!, inactive!]) {
                  await gateways.groupMembers.insertMembership({
                    clubId,
                    groupId: seniorId,
                    userId: member.id,
                  });
                }

                await expect(
                  gateways.groupMembers.findCandidates({
                    clubId,
                    groupId: seniorId,
                  }),
                ).resolves.toEqual({
                  kind: "found",
                  members: [
                    { id: active!.id, fullName: "Ana Active" },
                    { id: incomplete!.id, fullName: "ivan Incomplete" },
                  ],
                });
                // El inactive sigue asignado, pero no cuenta ni se lista.
                await expect(
                  gateways.groupMembers.findGroupMembers({
                    clubId,
                    groupId: seniorId,
                  }),
                ).resolves.toEqual({
                  kind: "found",
                  members: [{ id: assigned!.id, fullName: "Zoe Assigned" }],
                });
              },
            ),
        ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un grupo o un socio de otro club, o que no existen, no se alcanzan",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createGroupMembersGateways(serviceClient.client);
      const missingId = randomUUID();

      await withTwoClubs(serviceClient, ([clubId, otherClubId]) =>
        withMembers(
          serviceClient,
          [
            { clubId, fullName: "Paula Player", accountStatus: "incomplete" },
            {
              clubId: otherClubId,
              fullName: "Otto Neighbour",
              accountStatus: "active",
            },
          ],
          ([paula, neighbour]) =>
            withGroups(
              serviceClient,
              [clubId, otherClubId],
              async ({ seniorId, otherClubGroupId }) => {
                await expect(
                  gateways.groupMembers.findClubMember({
                    clubId,
                    userId: paula!.id,
                  }),
                ).resolves.toEqual({
                  id: paula!.id,
                  fullName: "Paula Player",
                  accountStatus: "incomplete",
                });
                for (const userId of [neighbour!.id, missingId]) {
                  await expect(
                    gateways.groupMembers.findClubMember({ clubId, userId }),
                  ).resolves.toBeNull();
                }

                for (const groupId of [otherClubGroupId, missingId]) {
                  const membership = { clubId, groupId, userId: paula!.id };
                  await expect(
                    gateways.groupMembers.insertMembership(membership),
                  ).resolves.toEqual({ kind: "group_not_found" });
                  await expect(
                    gateways.groupMembers.deleteMembership(membership),
                  ).resolves.toEqual({ kind: "group_not_found" });
                  await expect(
                    gateways.groupMembers.findGroupMembers({ clubId, groupId }),
                  ).resolves.toEqual({ kind: "group_not_found" });
                  await expect(
                    gateways.groupMembers.findCandidates({ clubId, groupId }),
                  ).resolves.toEqual({ kind: "group_not_found" });
                }

                await expect(
                  gateways.groupMembers.insertMembership({
                    clubId,
                    groupId: seniorId,
                    userId: missingId,
                  }),
                ).resolves.toEqual({ kind: "member_not_found" });
              },
            ),
        ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
