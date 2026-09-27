import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseNotificationWriter } from "@/lib/notifications/supabase-notification-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  NewsAudienceGateway,
  NewsPublishGateways,
} from "./news-publication-notice";
import { createNewsAttachmentGateways } from "./supabase-news-attachment-gateways";

/**
 * Publicar contra Supabase (#332): lo de los adjuntos, más la audiencia y los
 * avisos. Va con la llave de servicio, así que cada consulta filtra por el
 * club de la publicación.
 */

const MEMBERS_TABLE = "members";
const GROUP_MEMBERSHIPS_TABLE = "group_memberships";

type Environment = Readonly<Record<string, string | undefined>>;

const userIdRowsSchema = z.array(z.object({ user_id: z.string() }));

function createNewsAudienceGateway(
  serviceClient: SupabaseClient,
): NewsAudienceGateway {
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

export function createNewsPublishGateways(
  serviceClient: SupabaseClient,
): NewsPublishGateways {
  return {
    ...createNewsAttachmentGateways(serviceClient),
    newsAudience: createNewsAudienceGateway(serviceClient),
    notifications: createSupabaseNotificationWriter(serviceClient),
  };
}

export type NewsPublishGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: NewsPublishGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición del endpoint de publicar. Devuelve las variables que
 * faltan en vez de lanzar, como las demás. */
export function createSupabaseNewsPublishGateways(
  env: Environment,
): NewsPublishGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createNewsPublishGateways(createServiceRoleClient(env)),
  };
}
