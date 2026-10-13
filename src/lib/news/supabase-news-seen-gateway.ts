import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type { NewsSeenGateway } from "./news-seen";

/**
 * Adaptador entre la marca de visita a Noticias (#424) y Supabase. Escribe
 * con la llave de servicio porque `authenticated` sólo lee su fila de
 * `members` (`0048_news_seen_at.sql`). La lee el inicio y el feed (#594).
 */

type Environment = Readonly<Record<string, string | undefined>>;

const MEMBERS_TABLE = "members";

const newsSeenRowSchema = z.object({ news_seen_at: z.string().nullable() });

async function findNewsSeenAt(
  serviceClient: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await serviceClient
    .from(MEMBERS_TABLE)
    .select("news_seen_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer la visita a Noticias de ${userId}: ${error.message}`,
    );
  }
  if (data === null) {
    throw new MemberNotFoundError(userId);
  }
  return newsSeenRowSchema.parse(data).news_seen_at;
}

export function createNewsSeenGateway(
  serviceClient: SupabaseClient,
): NewsSeenGateway {
  return {
    async markNewsSeen({ userId, seenAt }) {
      const { data, error } = await serviceClient
        .from(MEMBERS_TABLE)
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
    findNewsSeenAt: (userId) => findNewsSeenAt(serviceClient, userId),
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
