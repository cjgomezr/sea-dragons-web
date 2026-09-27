import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAudienceMembersGateway } from "@/lib/notifications/supabase-audience-members";
import { createSupabaseNotificationWriter } from "@/lib/notifications/supabase-notification-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type { NewsPublishGateways } from "./news-publication-notice";
import { createNewsAttachmentGateways } from "./supabase-news-attachment-gateways";

/**
 * Publicar contra Supabase (#332): lo de los adjuntos, más la audiencia y los
 * avisos. Va con la llave de servicio, así que cada consulta filtra por el
 * club de la publicación.
 */

type Environment = Readonly<Record<string, string | undefined>>;

export function createNewsPublishGateways(
  serviceClient: SupabaseClient,
): NewsPublishGateways {
  return {
    ...createNewsAttachmentGateways(serviceClient),
    newsAudience: createSupabaseAudienceMembersGateway(serviceClient),
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
