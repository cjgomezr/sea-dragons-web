import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAccountStatus } from "@/lib/auth/account-status";
import { readRequiredText } from "@/lib/auth/supabase-auth-gateways";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  ClubMember,
  GroupMember,
  GroupMembersGateways,
  GroupMembersResult,
  GroupScope,
  MembershipInsertResult,
} from "./group-members";
import { compareNames } from "./name-order";

/**
 * Adaptadores entre los socios de un grupo y Supabase.
 *
 * Van por la llave de servicio, como los de los grupos: `0015_groups.sql` no
 * deja escribir pertenencias a `authenticated`. Cada consulta filtra por el
 * club de quien llama, y al escribir, las claves foráneas compuestas impiden
 * además mezclar un grupo o un socio de otro club.
 *
 * Las listas se arman con consultas fijas y no incrustando `members` en las
 * pertenencias, por lo mismo que `supabase-groups-gateways.ts`: esa relación
 * va por una clave compuesta y PostgREST podría dejar de deducirla. El club
 * tiene decenas de socios, no miles.
 */

const GROUPS_TABLE = "groups";
const MEMBERSHIPS_TABLE = "group_memberships";
const MEMBERS_TABLE = "members";
const MEMBER_COLUMNS = "user_id, full_name, account_status";
const INACTIVE_STATUS = "inactive";

/** El código de Postgres de una clave foránea violada, y las dos claves de las
 * pertenencias. Se mira el nombre para saber cuál de las dos no encontró su
 * fila: el grupo (no existe, es de otro club o lo acaban de borrar) o el
 * socio. */
const FOREIGN_KEY_VIOLATION_CODE = "23503";
const GROUP_FOREIGN_KEY = "group_memberships_group_same_club_fkey";
const MEMBER_FOREIGN_KEY = "group_memberships_member_same_club_fkey";

type Environment = Readonly<Record<string, string | undefined>>;

type Row = Record<string, unknown>;

function toClubMember(row: Row): ClubMember {
  const value = readRequiredText(row, "account_status", MEMBERS_TABLE);
  const accountStatus = parseAccountStatus(value);
  if (accountStatus === null) {
    throw new Error(`${value} no es un estado de cuenta que se reconozca.`);
  }
  return {
    id: readRequiredText(row, "user_id", MEMBERS_TABLE),
    fullName: readRequiredText(row, "full_name", MEMBERS_TABLE),
    accountStatus,
  };
}

function toGroupMember(member: ClubMember): GroupMember {
  return { id: member.id, fullName: member.fullName };
}

function compareMemberNames(a: GroupMember, b: GroupMember): number {
  return compareNames(a.fullName, b.fullName);
}

async function groupExists(
  serviceClient: SupabaseClient,
  { clubId, groupId }: GroupScope,
): Promise<boolean> {
  const { data, error } = await serviceClient
    .from(GROUPS_TABLE)
    .select("id")
    .eq("id", groupId)
    .eq("club_id", clubId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer el grupo ${groupId} del club ${clubId}: ${error.message}`,
    );
  }
  return data !== null;
}

/** Los ids de los socios asignados al grupo, o `null` si el grupo no es del
 * club. */
async function readAssignedIds(
  serviceClient: SupabaseClient,
  scope: GroupScope,
): Promise<ReadonlySet<string> | null> {
  if (!(await groupExists(serviceClient, scope))) {
    return null;
  }
  const { data, error } = await serviceClient
    .from(MEMBERSHIPS_TABLE)
    .select("user_id")
    .eq("group_id", scope.groupId)
    .eq("club_id", scope.clubId);
  if (error) {
    throw new Error(
      `No se pudieron leer los socios del grupo ${scope.groupId}: ${error.message}`,
    );
  }
  return new Set(
    data.map((row: Row) => readRequiredText(row, "user_id", MEMBERSHIPS_TABLE)),
  );
}

/** Los socios del club que no están dados de baja. */
async function readAssignableMembers(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<readonly GroupMember[]> {
  const { data, error } = await serviceClient
    .from(MEMBERS_TABLE)
    .select(MEMBER_COLUMNS)
    .eq("club_id", clubId)
    .neq("account_status", INACTIVE_STATUS);
  if (error) {
    throw new Error(
      `No se pudieron leer los socios del club ${clubId}: ${error.message}`,
    );
  }
  return data.map((row: Row) => toGroupMember(toClubMember(row)));
}

/** Los socios del club que no están de baja, repartidos según estén o no en
 * el grupo: `isAssigned` elige qué mitad se devuelve. */
async function findMembersBy(
  serviceClient: SupabaseClient,
  scope: GroupScope,
  isAssigned: boolean,
): Promise<GroupMembersResult> {
  const [assignedIds, members] = await Promise.all([
    readAssignedIds(serviceClient, scope),
    readAssignableMembers(serviceClient, scope.clubId),
  ]);
  if (assignedIds === null) {
    return { kind: "group_not_found" };
  }
  return {
    kind: "found",
    members: members
      .filter((member) => assignedIds.has(member.id) === isAssigned)
      .sort(compareMemberNames),
  };
}

function toInsertFailure(
  error: { readonly code: string; readonly message: string },
  membership: { readonly groupId: string; readonly userId: string },
): MembershipInsertResult {
  if (error.code === FOREIGN_KEY_VIOLATION_CODE) {
    if (error.message.includes(GROUP_FOREIGN_KEY)) {
      return { kind: "group_not_found" };
    }
    if (error.message.includes(MEMBER_FOREIGN_KEY)) {
      return { kind: "member_not_found" };
    }
  }
  throw new Error(
    `No se pudo asignar el socio ${membership.userId} al grupo ${membership.groupId}: ${error.message}`,
  );
}

export function createGroupMembersGateways(
  serviceClient: SupabaseClient,
): GroupMembersGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    groupMembers: {
      findGroupMembers: (scope) => findMembersBy(serviceClient, scope, true),
      findCandidates: (scope) => findMembersBy(serviceClient, scope, false),

      async findClubMember({ clubId, userId }) {
        const { data, error } = await serviceClient
          .from(MEMBERS_TABLE)
          .select(MEMBER_COLUMNS)
          .eq("user_id", userId)
          .eq("club_id", clubId)
          .maybeSingle();
        if (error) {
          throw new Error(
            `No se pudo leer el socio ${userId} del club ${clubId}: ${error.message}`,
          );
        }
        return data === null ? null : toClubMember(data);
      },

      // `on conflict do nothing` sobre la clave primaria: asignar dos veces
      // deja una sola fila y no es un error.
      async insertMembership({ clubId, groupId, userId }) {
        const { error } = await serviceClient
          .from(MEMBERSHIPS_TABLE)
          .upsert(
            { club_id: clubId, group_id: groupId, user_id: userId },
            { onConflict: "group_id,user_id", ignoreDuplicates: true },
          );
        if (error) {
          return toInsertFailure(error, { groupId, userId });
        }
        return { kind: "assigned" };
      },

      async deleteMembership(membership) {
        const { clubId, groupId, userId } = membership;
        if (!(await groupExists(serviceClient, membership))) {
          return { kind: "group_not_found" };
        }
        const { error } = await serviceClient
          .from(MEMBERSHIPS_TABLE)
          .delete()
          .eq("group_id", groupId)
          .eq("user_id", userId)
          .eq("club_id", clubId);
        if (error) {
          throw new Error(
            `No se pudo quitar el socio ${userId} del grupo ${groupId}: ${error.message}`,
          );
        }
        return { kind: "removed" };
      },
    },
  };
}

export type GroupMembersGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: GroupMembersGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición para los endpoints de socios de un grupo. */
export function createSupabaseGroupMembersGateways(
  env: Environment,
): GroupMembersGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createGroupMembersGateways(createServiceRoleClient(env)),
  };
}
