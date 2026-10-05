import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { createRouteClubPriceReader } from "@/lib/stripe/club-prices";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type { SessionPacksGateways } from "./session-packs";

/**
 * Adaptador entre los packs de sesiones (#469) y Supabase, con el precio de
 * la sesión Casual leído de Stripe (#486).
 *
 * Va por la llave de servicio: `0056_club_session_pack_options.sql` no deja
 * escribir a nadie más. El dominio ya comprobó quién llama, y cada consulta
 * filtra por su club.
 */

const PACK_OPTIONS_TABLE = "club_session_pack_options";
const REPLACE_PACK_OPTIONS_FUNCTION = "replace_club_session_pack_options";

type Environment = Readonly<Record<string, string | undefined>>;

type PackOptionRow = { readonly sessions: number };

async function findPackSizes(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<readonly number[]> {
  const { data, error } = await serviceClient
    .from(PACK_OPTIONS_TABLE)
    .select("sessions")
    .eq("club_id", clubId)
    .order("position")
    .overrideTypes<PackOptionRow[], { merge: false }>();
  if (error) {
    throw new Error(
      `No se pudieron leer los packs de sesiones del club ${clubId}: ${error.message}`,
    );
  }
  return data.map((row) => row.sessions);
}

/** Una sola llamada a la función de la migración: o queda la lista entera o
 * ninguna parte de ella. */
async function replacePackSizes(
  serviceClient: SupabaseClient,
  clubId: string,
  sizes: readonly number[],
): Promise<void> {
  const { error } = await serviceClient.rpc(REPLACE_PACK_OPTIONS_FUNCTION, {
    acting_club_id: clubId,
    pack_sessions: sizes,
  });
  if (error) {
    throw new Error(
      `No se pudieron guardar los packs de sesiones del club ${clubId}: ${error.message}`,
    );
  }
}

/** La lista del club: la lee también la compra de un pack (#471). */
export function createPackOptionsGateway(
  serviceClient: SupabaseClient,
): SessionPacksGateways["packs"] {
  return {
    findPackSizes: (clubId) => findPackSizes(serviceClient, clubId),
    replacePackSizes: (clubId, sizes) =>
      replacePackSizes(serviceClient, clubId, sizes),
  };
}

export function createSessionPacksGateways(
  serviceClient: SupabaseClient,
): SessionPacksGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    packs: createPackOptionsGateway(serviceClient),
    sessionPrice: {
      readCasualSessionPrice: () =>
        createRouteClubPriceReader().readPrice("casualSession"),
    },
    audit: createSupabaseAuditLogWriter(serviceClient),
  };
}

export type SessionPacksGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: SessionPacksGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición del endpoint. Devuelve las variables que faltan en vez
 * de lanzar, como las demás. */
export function createSupabaseSessionPacksGateways(
  env: Environment,
): SessionPacksGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createSessionPacksGateways(createServiceRoleClient(env)),
  };
}
