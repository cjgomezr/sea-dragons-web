import type { SupabaseClient } from "@supabase/supabase-js";
import { readRequiredText, readText } from "@/lib/auth/supabase-auth-gateways";
import { createGroupMembersGateways } from "@/lib/groups/supabase-group-members-gateways";
import { createGroupsGateways } from "@/lib/groups/supabase-groups-gateways";
import { createSupabaseMemberGroupsGateway } from "@/lib/groups/supabase-member-groups-gateway";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  AufRegistration,
  MemberRecordGateways,
  StoredMemberRecord,
} from "./member-record";

/**
 * Adaptador entre la ficha reservada al Admin (#242) y Supabase.
 *
 * Va por la llave de servicio: `authenticated` no tiene `update` sobre
 * `members` (`0003_members.sql`), y la policy sólo deja leer la fila propia.
 * El servidor ya comprobó que quien pide es Admin, y cada consulta filtra por
 * su club: es lo único que separa un club de otro con esta llave (NFR-009).
 *
 * Los grupos se leen y se escriben con los adaptadores de E4, los mismos que
 * usa la sección Grupos.
 */

const MEMBERS_TABLE = "members";
const RECORD_COLUMNS = "user_id, full_name, joined_on, auf_number, auf_expiry";

type Environment = Readonly<Record<string, string | undefined>>;

type Row = Record<string, unknown>;

function toStoredMemberRecord(row: Row): StoredMemberRecord {
  return {
    userId: readRequiredText(row, "user_id", MEMBERS_TABLE),
    fullName: readRequiredText(row, "full_name", MEMBERS_TABLE),
    // Las columnas `date` llegan como YYYY-MM-DD, el formato con el que el
    // dominio las compara.
    joinedOn: readRequiredText(row, "joined_on", MEMBERS_TABLE),
    aufNumber: readText(row, "auf_number", MEMBERS_TABLE),
    aufExpiry: readText(row, "auf_expiry", MEMBERS_TABLE),
  };
}

function toAufColumns(registration: AufRegistration): {
  readonly auf_number: string | null;
  readonly auf_expiry: string | null;
} {
  return registration.kind === "none"
    ? { auf_number: null, auf_expiry: null }
    : { auf_number: registration.number, auf_expiry: registration.expiry };
}

export function createMemberRecordGateways(
  serviceClient: SupabaseClient,
): MemberRecordGateways {
  const groupMembersGateways = createGroupMembersGateways(serviceClient);
  // Con la llave de servicio este adaptador vería los grupos de cualquiera;
  // lo acota el `user_id` que filtra, y el socio ya se buscó en el club.
  const memberGroups = createSupabaseMemberGroupsGateway(serviceClient);
  return {
    members: groupMembersGateways.members,
    groupMembers: groupMembersGateways.groupMembers,
    groups: createGroupsGateways(serviceClient).groups,
    records: {
      async findMemberRecord({ clubId, userId }) {
        const { data, error } = await serviceClient
          .from(MEMBERS_TABLE)
          .select(RECORD_COLUMNS)
          .eq("user_id", userId)
          .eq("club_id", clubId)
          .maybeSingle();
        if (error) {
          throw new Error(
            `No se pudo leer la ficha del socio ${userId}: ${error.message}`,
          );
        }
        return data === null ? null : toStoredMemberRecord(data);
      },

      findMemberGroups: ({ userId }) => memberGroups.listGroupsOf(userId),

      // Un solo `update` con las dos columnas: Postgres no deja que otro
      // guardado se meta entre el número y el vencimiento.
      async updateAufRegistration({ clubId, userId }, registration) {
        const { data, error } = await serviceClient
          .from(MEMBERS_TABLE)
          .update(toAufColumns(registration))
          .eq("user_id", userId)
          .eq("club_id", clubId)
          .select("user_id")
          .maybeSingle();
        if (error) {
          throw new Error(
            `No se pudo guardar el AUF del socio ${userId}: ${error.message}`,
          );
        }
        return data === null
          ? { kind: "member_not_found" }
          : { kind: "updated" };
      },
    },
  };
}

export type MemberRecordGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: MemberRecordGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición del endpoint. Devuelve las variables que faltan en vez
 * de lanzar, como las demás. */
export function createSupabaseMemberRecordGateways(
  env: Environment,
): MemberRecordGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createMemberRecordGateways(createServiceRoleClient(env)),
  };
}
