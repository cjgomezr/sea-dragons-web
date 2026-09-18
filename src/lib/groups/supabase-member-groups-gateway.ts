import type { SupabaseClient } from "@supabase/supabase-js";
import { readRequiredText } from "@/lib/auth/supabase-auth-gateways";
import type { MemberGroup, MemberGroupsGateway } from "./member-groups";

/**
 * Mis grupos contra Supabase, con el cliente de la sesión del socio y no con
 * la llave de servicio. La RLS de `0015_groups.sql` ya limita lo que ese
 * cliente ve a sus pertenencias y a sus grupos, así que no hace falta saltarla.
 *
 * El filtro por `user_id` va igual: sin él, lo que devuelve dependería sólo de
 * qué cliente le pasen, y con la llave de servicio saldrían todos los grupos
 * del club.
 */

const GROUPS_TABLE = "groups";

/** El `!inner` convierte el embebido en un filtro: un grupo sin una
 * pertenencia del socio no sale. De la pertenencia no se pide nada más. */
const MEMBER_GROUP_COLUMNS = "id, name, group_memberships!inner(user_id)";
const MEMBERSHIP_USER_FILTER = "group_memberships.user_id";

function toMemberGroup(row: Record<string, unknown>): MemberGroup {
  return {
    id: readRequiredText(row, "id", GROUPS_TABLE),
    name: readRequiredText(row, "name", GROUPS_TABLE),
  };
}

export function createSupabaseMemberGroupsGateway(
  client: SupabaseClient,
): MemberGroupsGateway {
  return {
    async listGroupsOf(userId) {
      const { data, error } = await client
        .from(GROUPS_TABLE)
        .select(MEMBER_GROUP_COLUMNS)
        .eq(MEMBERSHIP_USER_FILTER, userId);
      if (error) {
        throw new Error(
          `No se pudieron leer los grupos del socio: ${error.message}`,
        );
      }
      return data.map(toMemberGroup);
    },
  };
}
