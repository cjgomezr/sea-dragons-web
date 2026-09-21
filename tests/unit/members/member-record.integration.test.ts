import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import {
  DEFAULT_DIRECTORY_QUERY,
  listDirectory,
} from "@/lib/directory/directory";
import { createDirectoryGateways } from "@/lib/directory/supabase-directory-gateways";
import {
  assignGroupMember,
  removeGroupMember,
} from "@/lib/groups/group-members";
import { createGroupMembersGateways } from "@/lib/groups/supabase-group-members-gateways";
import { createGroupsGateways } from "@/lib/groups/supabase-groups-gateways";
import {
  AUF_NUMBER_MAX_LENGTH,
  MemberRecordValidationError,
  updateMemberRecord,
} from "@/lib/members/member-record";
import { createMemberRecordGateways } from "@/lib/members/supabase-member-record-gateways";
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
 * La ficha reservada al Admin contra `seadragons-dev` (#242). Lo que ningún
 * doble puede afirmar: que el `check` del AUF de `0016` acepta lo que el
 * dominio deja pasar, que el directorio lee lo guardado, y que cambiar los
 * grupos desde la ficha deja los mismos conteos que hacerlo desde Grupos.
 *
 * Orden de limpieza: los grupos primero (y con ellos sus pertenencias), luego
 * los socios y al final el club.
 */

const MEMBERS_TABLE = "members";
const GROUPS_TABLE = "groups";
const TODAY_IN_CLUB = "2026-09-21";
const JOINED_ON = "2024-03-06";

type Seed = { readonly fullName: string; readonly role: Role };

async function withClub<T>(
  serviceClient: ServiceRoleClient,
  run: (clubId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    "clubs",
    [{ slug: `ficha-admin-${randomUUID()}`, name: "Club de la ficha" }],
    ([club]) => run(club!.id as string),
  );
}

async function withMembers<T>(
  serviceClient: ServiceRoleClient,
  clubId: string,
  seeds: readonly Seed[],
  run: (members: readonly TestUser[]) => Promise<T>,
): Promise<T> {
  const [first, ...rest] = seeds;
  if (first === undefined) {
    return run([]);
  }
  return withTestUser(serviceClient, async (user) => {
    const { error } = await serviceClient.client.from(MEMBERS_TABLE).insert({
      club_id: clubId,
      user_id: user.id,
      full_name: first.fullName,
      email: user.email,
      account_status: "active",
      role: first.role,
      joined_on: JOINED_ON,
    });
    if (error) {
      throw new Error(`No se pudo sembrar al socio: ${error.message}`);
    }
    return withMembers(serviceClient, clubId, rest, (others) =>
      run([user, ...others]),
    );
  });
}

async function withGroups<T>(
  serviceClient: ServiceRoleClient,
  clubId: string,
  run: (groupIds: readonly [string, string]) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    GROUPS_TABLE,
    [
      { club_id: clubId, name: "Senior Squad" },
      { club_id: clubId, name: "Masters Squad" },
    ],
    ([senior, masters]) => run([senior!.id as string, masters!.id as string]),
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

type Scenario = {
  readonly serviceClient: ServiceRoleClient;
  readonly clubId: string;
  readonly adminId: string;
  readonly players: readonly string[];
  readonly groupIds: readonly [string, string];
};

async function withScenario(run: (scenario: Scenario) => Promise<void>) {
  const serviceClient = createServiceRoleTestClient(process.env);
  await withClub(serviceClient, (clubId) =>
    withMembers(
      serviceClient,
      clubId,
      [
        { fullName: "Ana Admin", role: "Admin" },
        { fullName: "Paula Ficha", role: "Player" },
        { fullName: "Pedro Grupos", role: "Player" },
      ],
      ([admin, paula, pedro]) =>
        withGroups(serviceClient, clubId, (groupIds) =>
          run({
            serviceClient,
            clubId,
            adminId: admin!.id,
            players: [paula!.id, pedro!.id],
            groupIds,
          }),
        ),
    ),
  );
}

describeRls("ficha reservada al Admin contra seadragons-dev", () => {
  it(
    "cambiar grupos desde la ficha deja los mismos conteos que hacerlo desde Grupos",
    async () => {
      await withScenario(async (scenario) => {
        const { serviceClient, clubId, adminId, groupIds } = scenario;
        const [paulaId, pedroId] = scenario.players;
        const [seniorId, mastersId] = groupIds;
        const recordGateways = createMemberRecordGateways(serviceClient.client);
        const groupGateways = createGroupMembersGateways(serviceClient.client);
        const save = (groups: readonly string[]) =>
          updateMemberRecord(recordGateways, {
            callerId: adminId,
            userId: paulaId!,
            submission: { aufNumber: null, aufExpiry: null, groupIds: groups },
            todayInClub: TODAY_IN_CLUB,
          });
        const viaGroups = (groupId: string) => ({
          callerId: adminId,
          groupId,
          userId: pedroId!,
        });

        // Paula por la ficha, Pedro por la sección Grupos, los mismos pasos.
        await save([seniorId, mastersId]);
        await assignGroupMember(groupGateways, viaGroups(seniorId));
        await assignGroupMember(groupGateways, viaGroups(mastersId));
        await expect(readCounts(serviceClient, clubId)).resolves.toEqual({
          "Senior Squad": 2,
          "Masters Squad": 2,
        });

        const saved = await save([seniorId]);
        await removeGroupMember(groupGateways, viaGroups(mastersId));

        expect(saved.groups).toEqual([{ id: seniorId, name: "Senior Squad" }]);
        await expect(readCounts(serviceClient, clubId)).resolves.toEqual({
          "Senior Squad": 2,
          "Masters Squad": 0,
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "guarda el AUF y el directorio lo enseña, con el vencido marcado",
    async () => {
      await withScenario(async ({ serviceClient, adminId, players }) => {
        const paulaId = players[0]!;
        const gateways = createMemberRecordGateways(serviceClient.client);
        const longestNumber = "9".repeat(AUF_NUMBER_MAX_LENGTH);

        const saved = await updateMemberRecord(gateways, {
          callerId: adminId,
          userId: paulaId,
          submission: {
            aufNumber: longestNumber,
            aufExpiry: "2025-12-31",
            groupIds: [],
          },
          todayInClub: TODAY_IN_CLUB,
        });

        expect(saved).toMatchObject({
          joinedOn: JOINED_ON,
          aufNumber: longestNumber,
          aufExpiry: "2025-12-31",
          isAufExpired: true,
        });
        const listing = await listDirectory(
          createDirectoryGateways(serviceClient.client),
          {
            callerId: adminId,
            query: { ...DEFAULT_DIRECTORY_QUERY, search: "Paula Ficha" },
            todayInClub: TODAY_IN_CLUB,
          },
        );
        expect(listing.members).toEqual([
          expect.objectContaining({
            userId: paulaId,
            aufNumber: longestNumber,
            aufExpiry: "2025-12-31",
            isAufExpired: true,
          }),
        ]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "borrar el número deja sin valor las dos columnas",
    async () => {
      await withScenario(async ({ serviceClient, adminId, players }) => {
        const paulaId = players[0]!;
        const gateways = createMemberRecordGateways(serviceClient.client);
        const request = (aufNumber: string | null) => ({
          callerId: adminId,
          userId: paulaId,
          submission: { aufNumber, aufExpiry: "2027-06-30", groupIds: [] },
          todayInClub: TODAY_IN_CLUB,
        });
        await updateMemberRecord(gateways, request("AUF-1"));

        await updateMemberRecord(gateways, request(""));

        const { data, error } = await serviceClient.client
          .from(MEMBERS_TABLE)
          .select("auf_number, auf_expiry")
          .eq("user_id", paulaId)
          .single();
        expect(error).toBeNull();
        expect(data).toEqual({ auf_number: null, auf_expiry: null });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "rechaza un vencimiento anterior al ingreso guardado en la base",
    async () => {
      await withScenario(async ({ serviceClient, adminId, players }) => {
        const gateways = createMemberRecordGateways(serviceClient.client);

        await expect(
          updateMemberRecord(gateways, {
            callerId: adminId,
            userId: players[0]!,
            submission: {
              aufNumber: "AUF-1",
              aufExpiry: "2024-03-05",
              groupIds: [],
            },
            todayInClub: TODAY_IN_CLUB,
          }),
        ).rejects.toBeInstanceOf(MemberRecordValidationError);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
