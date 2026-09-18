import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { DEFAULT_CLUB_SLUG } from "@/lib/auth/supabase-auth-gateways";
import { listMemberGroups } from "@/lib/groups/member-groups";
import { createSupabaseMemberGroupsGateway } from "@/lib/groups/supabase-member-groups-gateway";
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
 * Mis grupos contra `seadragons-dev`, leídos con la sesión del socio y no con
 * la llave de servicio (#229). Lo que ningún doble puede afirmar: que el
 * adaptador de verdad, apoyado sólo en la RLS de `0015_groups.sql`, devuelve
 * los grupos del socio y ninguno de los que no son suyos.
 */

type SeededGroups = {
  readonly member: TestUser;
  readonly otherMember: TestUser;
  /** Nombres únicos por corrida: el nombre es único por club, y la suite
   * puede correr a la vez en otra máquina contra la misma base. */
  readonly shared: { readonly id: string; readonly name: string };
  readonly ownOnly: { readonly id: string; readonly name: string };
  readonly othersOnly: { readonly id: string; readonly name: string };
};

async function readClubId(serviceClient: ServiceRoleClient): Promise<string> {
  const { data, error } = await serviceClient.client
    .from("clubs")
    .select("id")
    .eq("slug", DEFAULT_CLUB_SLUG)
    .single();
  if (error || !data) {
    throw new Error(
      `No se pudo leer el club sembrado: ${error?.message ?? "sin datos"}`,
    );
  }
  return data.id as string;
}

function memberRow(clubId: string, user: TestUser): Record<string, unknown> {
  return {
    club_id: clubId,
    user_id: user.id,
    full_name: "Socio con grupos",
    email: user.email,
    account_status: "active",
  };
}

function toGroup(row: Record<string, unknown> | undefined): {
  readonly id: string;
  readonly name: string;
} {
  if (row === undefined) {
    throw new Error("el arnés no devolvió un grupo que acababa de sembrar");
  }
  return { id: row.id as string, name: row.name as string };
}

async function insertMemberships(
  serviceClient: ServiceRoleClient,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  // Sin limpieza propia: borrar el grupo se lleva sus pertenencias.
  const { error } = await serviceClient.client
    .from("group_memberships")
    .insert(rows);
  if (error) {
    throw new Error(
      `No se pudieron sembrar las pertenencias: ${error.message}`,
    );
  }
}

/** Dos socios del club y tres grupos: uno de los dos, uno sólo del primero y
 * uno sólo del segundo. Todo se deshace al terminar. */
async function withTwoMembersInGroups<T>(
  serviceClient: ServiceRoleClient,
  run: (seeded: SeededGroups) => Promise<T>,
): Promise<T> {
  const clubId = await readClubId(serviceClient);
  const suffix = randomUUID().slice(0, 8);
  return withTestUser(serviceClient, (member) =>
    withTestUser(serviceClient, (otherMember) =>
      withSeededRows(
        serviceClient,
        "members",
        [memberRow(clubId, member), memberRow(clubId, otherMember)],
        () =>
          withSeededRows(
            serviceClient,
            "groups",
            [
              { club_id: clubId, name: `Senior Squad ${suffix}` },
              { club_id: clubId, name: `Masters Squad ${suffix}` },
              { club_id: clubId, name: `Junior Squad ${suffix}` },
            ],
            async (rows) => {
              const [shared, ownOnly, othersOnly] = rows.map(toGroup);
              if (!shared || !ownOnly || !othersOnly) {
                throw new Error("faltan grupos sembrados");
              }
              await insertMemberships(serviceClient, [
                { club_id: clubId, group_id: shared.id, user_id: member.id },
                { club_id: clubId, group_id: ownOnly.id, user_id: member.id },
                {
                  club_id: clubId,
                  group_id: shared.id,
                  user_id: otherMember.id,
                },
                {
                  club_id: clubId,
                  group_id: othersOnly.id,
                  user_id: otherMember.id,
                },
              ]);
              return run({
                member,
                otherMember,
                shared,
                ownOnly,
                othersOnly,
              });
            },
          ),
      ),
    ),
  );
}

describeRls("mis grupos contra seadragons-dev", () => {
  it(
    "la sesión del socio lee sólo sus grupos, una vez cada uno y en orden",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withTwoMembersInGroups(serviceClient, async (seeded) => {
        const session = await createRlsClient(
          {
            role: "authenticated",
            email: seeded.member.email,
            password: seeded.member.password,
          },
          process.env,
        );
        const gateway = createSupabaseMemberGroupsGateway(session.client);

        const groups = await listMemberGroups(gateway, seeded.member.id);

        expect(groups).toEqual([seeded.ownOnly, seeded.shared]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "la sesión de un socio no lee los grupos de otro aunque pregunte por él",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withTwoMembersInGroups(serviceClient, async (seeded) => {
        const session = await createRlsClient(
          {
            role: "authenticated",
            email: seeded.member.email,
            password: seeded.member.password,
          },
          process.env,
        );
        const gateway = createSupabaseMemberGroupsGateway(session.client);

        const groups = await gateway.listGroupsOf(seeded.otherMember.id);

        expect(groups).toEqual([]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
