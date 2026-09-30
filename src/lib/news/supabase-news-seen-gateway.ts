import type { SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type { NewsSeenGateway } from "./news-seen";

/**
 * Adaptador entre la marca de visita a Noticias (#424) y Supabase. Escribe
 * con la llave de servicio porque `authenticated` sólo lee su fila de
 * `members` (`0048_news_seen_at.sql`).
 */

type Environment = Readonly<Record<string, string | undefined>>;

export function createNewsSeenGateway(
  serviceClient: SupabaseClient,
): NewsSeenGateway {
  return {
    async markNewsSeen({ userId, seenAt }) {
      const { data, error } = await serviceClient
        .from("members")
        .update({ news_seen_at: seenAt })
        .eq("user_id", userId)
        .select("user_id");
      if (error) {
        throw new Error(
          `No se pudo guardar la visita a Noticias de ${userId}: ${error.message}`,
        );
      }
      return data.length === 0 ? "not_found" : "marked";
    },
  };
}

export type NewsSeenGatewayResult =
  | { readonly kind: "ready"; readonly gateway: NewsSeenGateway }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición del endpoint de la marca. Devuelve las variables que
 * faltan en vez de lanzar, como las demás. */
export function createSupabaseNewsSeenGateway(
  env: Environment,
): NewsSeenGatewayResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateway: createNewsSeenGateway(createServiceRoleClient(env)),
  };
}
