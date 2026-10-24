import type { SupabaseClient } from "@supabase/supabase-js";
import { readRequiredText } from "@/lib/auth/supabase-auth-gateways";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type { CommonCountriesGateways } from "./common-countries";

/**
 * Adaptador entre los países más comunes del club (#864) y Supabase: lee
 * `members.country` (`0003_members.sql`).
 *
 * Va por la llave de servicio, que se salta RLS: el servidor ya comprobó que
 * quien pide es Admin, y lo único que separa un club de otro es el filtro por
 * `club_id` (NFR-009). Lee sólo la columna del país, nunca quién lo tiene.
 */

const MEMBERS_TABLE = "members";

type Environment = Readonly<Record<string, string | undefined>>;

/** PostgREST corta en `max_rows` (1000 en Supabase) sin avisar. Un club de
 * decenas de socios no llega; si alguno llegara, toca contar en SQL. */
async function listMemberCountries(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<readonly string[]> {
  const { data, error } = await serviceClient
    .from(MEMBERS_TABLE)
    .select("country")
    .eq("club_id", clubId)
    .not("country", "is", null);
  if (error) {
    throw new Error(
      `No se pudieron leer los países de los socios del club ${clubId}: ${error.message}`,
    );
  }
  return data.map((row: Record<string, unknown>) =>
    readRequiredText(row, "country", MEMBERS_TABLE),
  );
}

export function createCommonCountriesGateways(
  serviceClient: SupabaseClient,
): CommonCountriesGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    countries: {
      listMemberCountries: (clubId) =>
        listMemberCountries(serviceClient, clubId),
    },
  };
}

export type CommonCountriesGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: CommonCountriesGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición del endpoint. Devuelve las variables que faltan en vez
 * de lanzar, como las demás. */
export function createSupabaseCommonCountriesGateways(
  env: Environment,
): CommonCountriesGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createCommonCountriesGateways(createServiceRoleClient(env)),
  };
}
