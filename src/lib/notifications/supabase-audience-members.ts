import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AudienceMembersGateway } from "./audience-members";

/**
 * La audiencia de un aviso contra Supabase (#332, #310). Va con la llave de
 * servicio, así que filtra siempre por el club.
 */

const MEMBERS_TABLE = "members";
const GROUP_MEMBERSHIPS_TABLE = "group_memberships";

const userIdRowsSchema = z.array(z.object({ user_id: z.string() }));

export function createSupabaseAudienceMembersGateway(
  serviceClient: SupabaseClient,
): AudienceMembersGateway {
  return {
    async findAudienceMemberIds({ clubId, audience }) {
      if (audience.kind === "groups" && audience.groupIds.length === 0) {
        return [];
      }
      const query =
        audience.kind === "club"
          ? serviceClient.from(MEMBERS_TABLE).select("user_id")
          : serviceClient
              .from(GROUP_MEMBERSHIPS_TABLE)
              .select("user_id")
              .in("group_id", audience.groupIds);
      const { data, error } = await query.eq("club_id", clubId);
      if (error) {
        throw new Error(
          `No se pudo leer la audiencia en el club ${clubId}: ${error.message}`,
        );
      }
      // Quien está en dos de los grupos sale dos veces.
      return [
        ...new Set(userIdRowsSchema.parse(data).map((row) => row.user_id)),
      ];
    },
  };
}
