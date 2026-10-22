import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  ACCOUNT_STATUSES,
  parseAccountStatus,
} from "@/lib/auth/account-status";
import { readRequiredText } from "@/lib/auth/supabase-auth-gateways";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { toPositionNames } from "@/lib/club/supabase-club-positions";
import { signProfilePhotoUrls } from "@/lib/members/supabase-profile-photo-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  AssignableMember,
  AssignableMembersResult,
  ClubMember,
  GroupMembersGateways,
  GroupScope,
  MembershipInsertResult,
} from "./group-members";

/**
 * Adaptadores entre los socios de un grupo y Supabase.
 *
 * Van por la llave de servicio, como los de los grupos: `0015_groups.sql` no
 * deja escribir pertenencias a `authenticated`. Cada consulta filtra por el
 * club de quien llama, y al escribir, las claves foráneas compuestas impiden
 * además mezclar un grupo o un socio de otro club.
 *
 * Las listas salen de una lectura de los socios del club con su posición y
 * sus pertenencias incrustadas, como el directorio: el reparto entre los del
 * grupo y los candidatos lo hace el dominio. El club tiene decenas de socios,
 * no miles.
 */

const GROUPS_TABLE = "groups";
const MEMBERSHIPS_TABLE = "group_memberships";
const MEMBERS_TABLE = "members";
const MEMBER_COLUMNS = "user_id, full_name, account_status";
const ASSIGNABLE_COLUMNS = [
  "user_id, full_name, account_status, photo_path",
  "position:club_positions!members_position_same_club_fkey(id, names:club_position_names(locale, name))",
  "group_memberships(group_id)",
].join(", ");
const INACTIVE_STATUS = "inactive";

const assignableRowSchema = z.object({
  user_id: z.uuid(),
  full_name: z.string(),
  account_status: z.enum(ACCOUNT_STATUSES),
  photo_path: z.string().nullable(),
  position: z
    .object({
      id: z.uuid(),
      names: z.array(z.object({ locale: z.string(), name: z.string() })),
    })
    .nullable(),
  group_memberships: z.array(z.object({ group_id: z.uuid() })),
});

type AssignableRow = z.infer<typeof assignableRowSchema>;

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

function toAssignableMember(row: AssignableRow): AssignableMember {
  return {
    id: row.user_id,
    fullName: row.full_name,
    accountStatus: row.account_status,
    photoPath: row.photo_path,
    position: row.position === null ? null : toPositionNames(row.position),
    groupIds: row.group_memberships.map(({ group_id: groupId }) => groupId),
  };
}

/** Si el grupo existe y es del club. */
export async function groupExists(
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

/** Los socios del club que no están dados de baja, con los grupos del club
 * en los que está cada uno. */
async function readAssignableMembers(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<readonly AssignableMember[]> {
  const { data, error } = await serviceClient
    .from(MEMBERS_TABLE)
    .select(ASSIGNABLE_COLUMNS)
    .eq("club_id", clubId)
    .neq("account_status", INACTIVE_STATUS);
  if (error) {
    throw new Error(
      `No se pudieron leer los socios del club ${clubId}: ${error.message}`,
    );
  }
  const parsed = z.array(assignableRowSchema).safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Los socios del club ${clubId} volvieron con una forma que el dominio no reconoce: ${parsed.error.message}`,
    );
  }
  return parsed.data.map(toAssignableMember);
}

async function findAssignableMembers(
  serviceClient: SupabaseClient,
  scope: GroupScope,
): Promise<AssignableMembersResult> {
  const [isGroupOfClub, members] = await Promise.all([
    groupExists(serviceClient, scope),
    readAssignableMembers(serviceClient, scope.clubId),
  ]);
  return isGroupOfClub
    ? { kind: "found", members }
    : { kind: "group_not_found" };
}

function toInsertFailure(
  error: { readonly code: string; readonly message: string },
  membership: { readonly groupId: string; readonly userIds: readonly string[] },
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
    `No se pudo asignar a ${membership.userIds.join(", ")} al grupo ${membership.groupId}: ${error.message}`,
  );
}

export function createGroupMembersGateways(
  serviceClient: SupabaseClient,
): GroupMembersGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    groupMembers: {
      findAssignableMembers: (scope) =>
        findAssignableMembers(serviceClient, scope),

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
          return toInsertFailure(error, { groupId, userIds: [userId] });
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
    bulkMemberships: {
      async findClubMembers({ clubId, userIds }) {
        const { data, error } = await serviceClient
          .from(MEMBERS_TABLE)
          .select(MEMBER_COLUMNS)
          .eq("club_id", clubId)
          .in("user_id", userIds);
        if (error) {
          throw new Error(
            `No se pudieron leer los socios pedidos del club ${clubId}: ${error.message}`,
          );
        }
        return data.map(toClubMember);
      },

      // Un solo `insert ... on conflict do nothing`: una sentencia es atómica,
      // así que si una clave foránea falla no entra nadie.
      async insertMemberships({ clubId, groupId, userIds }) {
        const { error } = await serviceClient.from(MEMBERSHIPS_TABLE).upsert(
          userIds.map((userId) => ({
            club_id: clubId,
            group_id: groupId,
            user_id: userId,
          })),
          { onConflict: "group_id,user_id", ignoreDuplicates: true },
        );
        if (error) {
          return toInsertFailure(error, { groupId, userIds });
        }
        return { kind: "assigned" };
      },
    },
    photos: {
      signPhotoUrls: (photoPaths) =>
        signProfilePhotoUrls(serviceClient, photoPaths),
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
