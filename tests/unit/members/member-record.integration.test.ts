import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { listPendingRequirements } from "@/lib/auth/account-activation";
import type { Role } from "@/lib/auth/roles";
import { readSessionState } from "@/lib/auth/session-reader";
import { createSupabaseAuthGateways } from "@/lib/auth/supabase-auth-gateways";
import {
  DEFAULT_DIRECTORY_QUERY,
  listDirectory,
} from "@/lib/directory/directory";
import { createDirectoryGateways } from "@/lib/directory/supabase-directory-gateways";
import { createClubPositionsGateway } from "@/lib/club/supabase-club-positions";
import {
  assignGroupMember,
  removeGroupMember,
} from "@/lib/groups/group-members";
import { createGroupMembersGateways } from "@/lib/groups/supabase-group-members-gateways";
import { createGroupsGateways } from "@/lib/groups/supabase-groups-gateways";
import {
  AUF_NUMBER_MAX_LENGTH,
  MemberAufChangedError,
  MemberRecordValidationError,
  readMemberRecord,
  updateMemberRecord,
  verifyMemberAuf,
} from "@/lib/members/member-record";
import { updateOwnProfile } from "@/lib/members/own-profile";
import { createOwnProfileGateways } from "@/lib/members/supabase-own-profile-gateways";
import { createMemberRecordGateways } from "@/lib/members/supabase-member-record-gateways";
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
 * La ficha reservada al Admin contra `seadragons-dev` (#242). Lo que ningún
 * doble puede afirmar: que el `check` del AUF de `0016` acepta lo que el
 * dominio deja pasar, que el directorio lee lo guardado, y que cambiar los
 * grupos desde la ficha deja los mismos conteos que hacerlo desde Grupos.
 * Desde #274, también que la verificación del AUF que propuso el miembro sólo
 * se pone sobre el AUF que el Admin vio.
 *
 * Orden de limpieza: los grupos primero (y con ellos sus pertenencias), luego
 * los socios, la bitácora del club y al final el club.
 */

const MEMBERS_TABLE = "members";
const AUDIT_LOG_TABLE = "audit_log";
/** Mayor de edad hoy y el día en que se sembró la fila. */
const ADULT_BIRTH = "1990-05-10";
/** Menor el día en que se sembró la fila, que es hoy. */
const MINOR_BIRTH = "2015-01-01";
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
    async ([club]) => {
      const clubId = club!.id as string;
      try {
        return await run(clubId);
      } finally {
        // La bitácora nombra al club y no dejaría borrarlo.
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
  /** Paula con su contraseña, para entrar como ella. */
  readonly paula: TestUser;
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
            paula: paula!,
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
            submission: {
              auf: { aufNumber: null, aufExpiry: null },
              groupIds: groups,
              dateOfBirth: null,
            },
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
            auf: { aufNumber: longestNumber, aufExpiry: "2025-12-31" },
            groupIds: [],
            dateOfBirth: null,
          },
          todayInClub: TODAY_IN_CLUB,
        });

        expect(saved).toMatchObject({
          joinedOn: JOINED_ON,
          accountStatus: "active",
          aufNumber: longestNumber,
          aufExpiry: "2025-12-31",
          isAufExpired: true,
        });
        const listing = await listDirectory(
          createDirectoryGateways(
  serviceClient.client,
  createClubPositionsGateway(serviceClient.client),
),
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
          submission: {
            auf: { aufNumber, aufExpiry: "2027-06-30" },
            groupIds: [],
            dateOfBirth: null,
          },
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
              auf: { aufNumber: "AUF-1", aufExpiry: "2024-03-05" },
              groupIds: [],
              dateOfBirth: null,
            },
            todayInClub: TODAY_IN_CLUB,
          }),
        ).rejects.toBeInstanceOf(MemberRecordValidationError);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "la corrección que deja menor sin consentimiento manda a completar el registro, y la bitácora no guarda las fechas",
    async () => {
      await withScenario(async (scenario) => {
        const { serviceClient, clubId, adminId, paula } = scenario;
        await setDateOfBirth(serviceClient, paula.id, ADULT_BIRTH);

        const saved = await updateMemberRecord(
          createMemberRecordGateways(serviceClient.client),
          {
            callerId: adminId,
            userId: paula.id,
            submission: {
              auf: { aufNumber: null, aufExpiry: null },
              groupIds: [],
              dateOfBirth: MINOR_BIRTH,
            },
            todayInClub: TODAY_IN_CLUB,
          },
        );

        expect(saved).toMatchObject({
          dateOfBirth: MINOR_BIRTH,
          accountStatus: "incomplete",
          hasGuardianConsent: false,
        });
        await expect(pendingOf(paula.id)).resolves.toContain("guardianConsent");
        await expect(sessionKindOf(paula)).resolves.toBe("incomplete");
        const auditRows = await readAuditRows(serviceClient, clubId);
        expect(auditRows).toEqual([
          {
            actor_id: adminId,
            action: "member.date_of_birth_corrected",
            entity_type: "member",
            entity_id: paula.id,
            result: "success",
            metadata: null,
          },
        ]);
        expect(JSON.stringify(auditRows)).not.toContain(MINOR_BIRTH);
        expect(JSON.stringify(auditRows)).not.toContain(ADULT_BIRTH);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});

async function setDateOfBirth(
  serviceClient: ServiceRoleClient,
  userId: string,
  dateOfBirth: string,
): Promise<void> {
  const { error } = await serviceClient.client
    .from(MEMBERS_TABLE)
    .update({ date_of_birth: dateOfBirth })
    .eq("user_id", userId);
  if (error) {
    throw new Error(`No se pudo sembrar la fecha: ${error.message}`);
  }
}

/** Lo que la pantalla de completar registro le pediría, leído con la misma
 * regla y el mismo adaptador que ella. */
async function pendingOf(userId: string): Promise<readonly string[]> {
  const wiring = createSupabaseAuthGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new Error(`Faltan variables: ${wiring.missingKeys.join(", ")}`);
  }
  const account = await wiring.gateways.accounts.findByUserId(userId);
  if (account === null) {
    throw new Error(`No existe la cuenta ${userId}.`);
  }
  return listPendingRequirements({
    profile: account.profile,
    emailConfirmed: true,
  });
}

/** Lo que la frontera ve en la siguiente petición del socio, leído con su
 * propia sesión como lo lee el proxy. */
async function sessionKindOf(member: TestUser): Promise<string> {
  const { client } = await createRlsClient(
    { role: "authenticated", email: member.email, password: member.password },
    process.env,
  );
  return (await readSessionState(client)).kind;
}

async function readAuditRows(
  serviceClient: ServiceRoleClient,
  clubId: string,
): Promise<readonly unknown[]> {
  const { data, error } = await serviceClient.client
    .from(AUDIT_LOG_TABLE)
    .select("actor_id, action, entity_type, entity_id, result, metadata")
    .eq("club_id", clubId);
  if (error) {
    throw new Error(`No se pudo leer la bitácora: ${error.message}`);
  }
  return data;
}

/** Paula propone su AUF desde su perfil, como lo haría la pantalla. */
async function proposeAuf(
  serviceClient: ServiceRoleClient,
  userId: string,
  expiry: string | null,
): Promise<void> {
  await updateOwnProfile(createOwnProfileGateways(serviceClient.client), {
    userId,
    submission: {
      fullName: "Paula Ficha",
      country: "AU",
      position: null,
      experienceLevel: null,
      gender: null,
      auf: { number: "AUF-PROPUESTO", expiry },
    },
  });
}

describeRls("verificar el AUF contra seadragons-dev", () => {
  it.each([["2030-06-30"], [null]])(
    "el Admin verifica el AUF que propuso el miembro (vencimiento %s)",
    async (expiry) => {
      await withScenario(
        async ({ serviceClient, clubId, adminId, players }) => {
          const paulaId = players[0]!;
          const gateways = createMemberRecordGateways(serviceClient.client);
          await proposeAuf(serviceClient, paulaId, expiry);
          const request = {
            callerId: adminId,
            userId: paulaId,
            todayInClub: TODAY_IN_CLUB,
          };
          await expect(
            readMemberRecord(gateways, request),
          ).resolves.toMatchObject({ isAufVerified: false });

          const verified = await verifyMemberAuf(gateways, {
            ...request,
            expected: { aufNumber: "AUF-PROPUESTO", aufExpiry: expiry },
          });

          expect(verified).toMatchObject({
            aufNumber: "AUF-PROPUESTO",
            aufExpiry: expiry,
            isAufVerified: true,
          });
          await expect(readAuditRows(serviceClient, clubId)).resolves.toEqual([
            {
              actor_id: adminId,
              action: "member.auf_verified",
              entity_type: "member",
              entity_id: paulaId,
              result: "success",
              metadata: null,
            },
          ]);
        },
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "no verifica un AUF distinto del que el Admin vio",
    async () => {
      await withScenario(async ({ serviceClient, adminId, players }) => {
        const paulaId = players[0]!;
        const gateways = createMemberRecordGateways(serviceClient.client);
        await proposeAuf(serviceClient, paulaId, "2030-06-30");
        const request = {
          callerId: adminId,
          userId: paulaId,
          todayInClub: TODAY_IN_CLUB,
        };

        await expect(
          verifyMemberAuf(gateways, {
            ...request,
            expected: { aufNumber: "AUF-PROPUESTO", aufExpiry: "2031-01-01" },
          }),
        ).rejects.toBeInstanceOf(MemberAufChangedError);
        await expect(
          readMemberRecord(gateways, request),
        ).resolves.toMatchObject({ isAufVerified: false });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "el AUF que escribe el Admin en la ficha nace verificado",
    async () => {
      await withScenario(async ({ serviceClient, adminId, players }) => {
        const gateways = createMemberRecordGateways(serviceClient.client);

        const saved = await updateMemberRecord(gateways, {
          callerId: adminId,
          userId: players[0]!,
          submission: {
            auf: { aufNumber: "AUF-DEL-ADMIN", aufExpiry: "2030-06-30" },
            groupIds: [],
            dateOfBirth: null,
          },
          todayInClub: TODAY_IN_CLUB,
        });

        expect(saved.isAufVerified).toBe(true);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
