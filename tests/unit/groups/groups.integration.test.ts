import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Group, GroupsGateways } from "@/lib/groups/groups";
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
 * Los adaptadores de los grupos contra `seadragons-dev` (#226). Van con la
 * llave de servicio, que se salta RLS, así que lo único que separa un club de
 * otro es el filtro del adaptador (NFR-009). Los dobles de los tests de ruta
 * no lo ven; esto sí. También es el único sitio donde se ve que el índice
 * único de `0015_groups.sql` decide entre dos creaciones simultáneas.
 *
 * Los clubes son de usar y tirar, y los grupos se borran antes que ellos: la
 * clave foránea de `groups.club_id` no deja borrar un club con grupos.
 */

const CLUBS_TABLE = "clubs";
const MEMBERS_TABLE = "members";
const GROUPS_TABLE = "groups";
const MEMBERSHIPS_TABLE = "group_memberships";

type AccountStatus = "active" | "inactive";

async function withTwoClubs<T>(
  serviceClient: ServiceRoleClient,
  run: (clubIds: readonly [string, string]) => Promise<T>,
): Promise<T> {
  const club = (name: string) => ({ slug: `grupos-${randomUUID()}`, name });
  return withSeededRows(
    serviceClient,
    CLUBS_TABLE,
    [club("Club de los grupos"), club("Club vecino")],
    ([own, other]) => run([own!.id as string, other!.id as string]),
  );
}

async function withMember<T>(
  serviceClient: ServiceRoleClient,
  seed: { readonly clubId: string; readonly accountStatus: AccountStatus },
  run: (member: TestUser) => Promise<T>,
): Promise<T> {
  return withTestUser(serviceClient, async (user) => {
    const { error } = await serviceClient.client.from(MEMBERS_TABLE).insert({
      club_id: seed.clubId,
      user_id: user.id,
      full_name: `Socio ${seed.accountStatus}`,
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

async function assignMembers(
  serviceClient: ServiceRoleClient,
  assignment: {
    readonly clubId: string;
    readonly groupId: string;
    readonly userIds: readonly string[];
  },
): Promise<void> {
  const { error } = await serviceClient.client.from(MEMBERSHIPS_TABLE).insert(
    assignment.userIds.map((userId) => ({
      club_id: assignment.clubId,
      group_id: assignment.groupId,
      user_id: userId,
    })),
  );
  if (error) {
    throw new Error(`No se pudieron asignar los socios: ${error.message}`);
  }
}

/** Borra los grupos de los clubes de prueba pase lo que pase, para que la
 * limpieza de los clubes no choque con su clave foránea. */
async function withGroupCleanup<T>(
  serviceClient: ServiceRoleClient,
  clubIds: readonly string[],
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } finally {
    const { error } = await serviceClient.client
      .from(GROUPS_TABLE)
      .delete()
      .in("club_id", clubIds);
    if (error) {
      throw new Error(`No se pudieron borrar los grupos: ${error.message}`);
    }
  }
}

async function createOrFail(
  gateways: GroupsGateways,
  input: { readonly clubId: string; readonly name: string },
): Promise<Group> {
  const result = await gateways.groups.insertGroup(input);
  if (result.kind !== "created") {
    throw new Error(`No se pudo crear el grupo ${input.name}: ${result.kind}`);
  }
  return result.group;
}

describeRls("los grupos contra seadragons-dev", () => {
  it(
    "crean, listan con conteo sin los inactive, renombran y borran sólo dentro del club",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createGroupsGateways(serviceClient.client);

      await withTwoClubs(serviceClient, ([clubId, otherClubId]) =>
        withGroupCleanup(serviceClient, [clubId, otherClubId], () =>
          withMember(
            serviceClient,
            { clubId, accountStatus: "active" },
            (active) =>
              withMember(
                serviceClient,
                { clubId, accountStatus: "inactive" },
                async (inactive) => {
                  const senior = await createOrFail(gateways, {
                    clubId,
                    name: "Senior Squad",
                  });
                  expect(senior).toMatchObject({
                    name: "Senior Squad",
                    memberCount: 0,
                  });
                  const seniorId = senior.id;
                  // El mismo nombre en otro club no choca: es único por club.
                  await createOrFail(gateways, {
                    clubId: otherClubId,
                    name: "Senior Squad",
                  });
                  const { id: juniorId } = await createOrFail(gateways, {
                    clubId,
                    name: "Junior Squad",
                  });
                  await assignMembers(serviceClient, {
                    clubId,
                    groupId: seniorId,
                    userIds: [active.id, inactive.id],
                  });

                  await expect(
                    gateways.groups.insertGroup({
                      clubId,
                      name: "senior squad",
                    }),
                  ).resolves.toEqual({ kind: "name_taken" });
                  await expect(
                    gateways.groups.findClubGroups(clubId),
                  ).resolves.toEqual([
                    { id: juniorId, name: "Junior Squad", memberCount: 0 },
                    { id: seniorId, name: "Senior Squad", memberCount: 1 },
                  ]);

                  await expect(
                    gateways.groups.renameGroup({
                      clubId,
                      groupId: seniorId,
                      name: "Junior Squad",
                    }),
                  ).resolves.toEqual({ kind: "name_taken" });
                  await expect(
                    gateways.groups.renameGroup({
                      clubId,
                      groupId: seniorId,
                      name: "Masters Squad",
                    }),
                  ).resolves.toEqual({
                    kind: "renamed",
                    group: {
                      id: seniorId,
                      name: "Masters Squad",
                      memberCount: 1,
                    },
                  });
                  await expect(
                    gateways.groups.renameGroup({
                      clubId: otherClubId,
                      groupId: seniorId,
                      name: "Robado",
                    }),
                  ).resolves.toEqual({ kind: "not_found" });
                  await expect(
                    gateways.groups.deleteGroup({
                      clubId: otherClubId,
                      groupId: seniorId,
                    }),
                  ).resolves.toEqual({ kind: "not_found" });

                  await expect(
                    gateways.groups.deleteGroup({ clubId, groupId: seniorId }),
                  ).resolves.toEqual({ kind: "deleted" });
                  await expect(
                    gateways.groups.findClubGroups(clubId),
                  ).resolves.toEqual([
                    { id: juniorId, name: "Junior Squad", memberCount: 0 },
                  ]);
                  const { count, error } = await serviceClient.client
                    .from(MEMBERS_TABLE)
                    .select("user_id", { count: "exact", head: true })
                    .in("user_id", [active.id, inactive.id]);
                  expect(error).toBeNull();
                  expect(count).toBe(2);
                },
              ),
          ),
        ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "dejan un solo grupo cuando dos creaciones del mismo nombre llegan a la vez",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = createGroupsGateways(serviceClient.client);

      await withTwoClubs(serviceClient, ([clubId, otherClubId]) =>
        withGroupCleanup(serviceClient, [clubId, otherClubId], async () => {
          const results = await Promise.all([
            gateways.groups.insertGroup({ clubId, name: "Masters Squad" }),
            gateways.groups.insertGroup({ clubId, name: "masters squad" }),
          ]);

          expect(results.map((result) => result.kind).sort()).toEqual([
            "created",
            "name_taken",
          ]);
          await expect(
            gateways.groups.findClubGroups(clubId),
          ).resolves.toHaveLength(1);
        }),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
