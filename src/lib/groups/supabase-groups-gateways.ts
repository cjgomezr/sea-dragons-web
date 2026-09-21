import type { SupabaseClient } from "@supabase/supabase-js";
import { readRequiredText } from "@/lib/auth/supabase-auth-gateways";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import { compareNames } from "@/lib/text/name-order";
import type { Group, GroupsGateways } from "./groups";

/**
 * Adaptadores entre los grupos y Supabase.
 *
 * Van por la llave de servicio: `0015_groups.sql` no deja escribir a
 * `authenticated`, y sólo le deja leer los grupos a los que pertenece. Gestionar
 * es justo lo contrario, así que lo hace el servidor, que ya averiguó por la
 * cookie de sesión quién pregunta y de qué club. Cada consulta filtra por ese
 * club: es lo único que separa un club de otro con esta llave.
 */

const GROUPS_TABLE = "groups";
const MEMBERSHIPS_TABLE = "group_memberships";
const MEMBERS_TABLE = "members";
const GROUP_COLUMNS = "id, name";
const ACTIVE_STATUS = "active";

/** El código de Postgres de una violación de unicidad, y el índice del nombre
 * por club. Se mira el nombre para no confundir este choque con otro. */
const UNIQUE_VIOLATION_CODE = "23505";
const GROUP_NAME_INDEX = "groups_club_id_name_key";

function compareGroupNames(a: GroupRow, b: GroupRow): number {
  return compareNames(a.name, b.name);
}

type Environment = Readonly<Record<string, string | undefined>>;

type Row = Record<string, unknown>;

type GroupRow = { readonly id: string; readonly name: string };

function toGroupRow(row: Row): GroupRow {
  return {
    id: readRequiredText(row, "id", GROUPS_TABLE),
    name: readRequiredText(row, "name", GROUPS_TABLE),
  };
}

function isGroupNameViolation(error: {
  readonly code: string;
  readonly message: string;
}): boolean {
  return (
    error.code === UNIQUE_VIOLATION_CODE &&
    error.message.includes(GROUP_NAME_INDEX)
  );
}

async function readActiveMemberIds(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<ReadonlySet<string>> {
  const { data, error } = await serviceClient
    .from(MEMBERS_TABLE)
    .select("user_id")
    .eq("club_id", clubId)
    .eq("account_status", ACTIVE_STATUS);
  if (error) {
    throw new Error(
      `No se pudieron leer los socios activos del club ${clubId}: ${error.message}`,
    );
  }
  return new Set(
    data.map((row: Row) => readRequiredText(row, "user_id", MEMBERS_TABLE)),
  );
}

/**
 * Cuántos socios activos tiene cada grupo del club. No cuentan los dados de
 * baja (RF-3 de E4) ni los que todavía no activaron su cuenta, como el
 * miembro recién dado de alta por un Admin (#243).
 *
 * Son dos consultas fijas y no una que incruste `members` en las pertenencias:
 * esa relación va por una clave foránea compuesta contra una restricción única,
 * y una lectura que depende de cómo PostgREST la deduzca se rompe sin que nadie
 * toque este archivo (lo mismo que evita `supabase-club-administration-
 * gateways.ts`). El club tiene decenas de socios, no miles.
 */
async function readActiveMemberCounts(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<ReadonlyMap<string, number>> {
  const [memberships, activeIds] = await Promise.all([
    serviceClient
      .from(MEMBERSHIPS_TABLE)
      .select("group_id, user_id")
      .eq("club_id", clubId),
    readActiveMemberIds(serviceClient, clubId),
  ]);
  if (memberships.error) {
    throw new Error(
      `No se pudieron leer las pertenencias del club ${clubId}: ${memberships.error.message}`,
    );
  }
  const counts = new Map<string, number>();
  for (const row of memberships.data as Row[]) {
    if (!activeIds.has(readRequiredText(row, "user_id", MEMBERSHIPS_TABLE))) {
      continue;
    }
    const groupId = readRequiredText(row, "group_id", MEMBERSHIPS_TABLE);
    counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
  }
  return counts;
}

async function withMemberCount(
  serviceClient: SupabaseClient,
  clubId: string,
  group: GroupRow,
): Promise<Group> {
  const counts = await readActiveMemberCounts(serviceClient, clubId);
  return { ...group, memberCount: counts.get(group.id) ?? 0 };
}

export function createGroupsGateways(
  serviceClient: SupabaseClient,
): GroupsGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    groups: {
      async findClubGroups(clubId) {
        const [groups, counts] = await Promise.all([
          serviceClient
            .from(GROUPS_TABLE)
            .select(GROUP_COLUMNS)
            .eq("club_id", clubId),
          readActiveMemberCounts(serviceClient, clubId),
        ]);
        if (groups.error) {
          throw new Error(
            `No se pudieron leer los grupos del club ${clubId}: ${groups.error.message}`,
          );
        }
        return groups.data
          .map((row: Row) => {
            const group = toGroupRow(row);
            return { ...group, memberCount: counts.get(group.id) ?? 0 };
          })
          .sort(compareGroupNames);
      },

      async insertGroup({ clubId, name }) {
        const { data, error } = await serviceClient
          .from(GROUPS_TABLE)
          .insert({ club_id: clubId, name })
          .select(GROUP_COLUMNS)
          .single();
        if (error) {
          if (isGroupNameViolation(error)) {
            return { kind: "name_taken" };
          }
          throw new Error(
            `No se pudo crear el grupo en el club ${clubId}: ${error.message}`,
          );
        }
        // Un grupo recién creado no tiene pertenencias todavía.
        return {
          kind: "created",
          group: { ...toGroupRow(data), memberCount: 0 },
        };
      },

      async renameGroup({ clubId, groupId, name }) {
        const { data, error } = await serviceClient
          .from(GROUPS_TABLE)
          .update({ name })
          .eq("id", groupId)
          .eq("club_id", clubId)
          .select(GROUP_COLUMNS)
          .maybeSingle();
        if (error) {
          if (isGroupNameViolation(error)) {
            return { kind: "name_taken" };
          }
          throw new Error(
            `No se pudo renombrar el grupo ${groupId} del club ${clubId}: ${error.message}`,
          );
        }
        if (data === null) {
          return { kind: "not_found" };
        }
        return {
          kind: "renamed",
          group: await withMemberCount(serviceClient, clubId, toGroupRow(data)),
        };
      },

      async deleteGroup({ clubId, groupId }) {
        const { data, error } = await serviceClient
          .from(GROUPS_TABLE)
          .delete()
          .eq("id", groupId)
          .eq("club_id", clubId)
          .select("id");
        if (error) {
          throw new Error(
            `No se pudo borrar el grupo ${groupId} del club ${clubId}: ${error.message}`,
          );
        }
        return data.length === 0 ? { kind: "not_found" } : { kind: "deleted" };
      },
    },
  };
}

export type GroupsGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: GroupsGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición para los endpoints de grupos. Devuelve las variables
 * que faltan en vez de lanzar, como las demás. */
export function createSupabaseGroupsGateways(
  env: Environment,
): GroupsGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createGroupsGateways(createServiceRoleClient(env)),
  };
}
