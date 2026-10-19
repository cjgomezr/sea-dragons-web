import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { readRequiredText, readText } from "@/lib/auth/supabase-auth-gateways";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  ClubIdentity,
  ClubIdentityUpdate,
  ClubSettings,
  ClubSettingsGateways,
} from "./club-settings";
import { readClubLogoUrl } from "./supabase-club-logo-gateways";

/**
 * Adaptador entre la configuración del club (#296) y Supabase.
 *
 * Va por la llave de servicio: `0022_club_brand.sql` no deja escribir en
 * `clubs` a nadie más. El servidor ya comprobó que quien pide es Admin, y
 * cada consulta filtra por su club.
 */

const CLUBS_TABLE = "clubs";
const SETTINGS_COLUMNS =
  "name, initials, accent_color, logo_path, season_starts_on";

type Environment = Readonly<Record<string, string | undefined>>;

type Row = Record<string, unknown>;

function toClubSettings(serviceClient: SupabaseClient, row: Row): ClubSettings {
  return {
    name: readRequiredText(row, "name", CLUBS_TABLE),
    initials: readText(row, "initials", CLUBS_TABLE),
    accentColor: readRequiredText(row, "accent_color", CLUBS_TABLE),
    logoUrl: readClubLogoUrl(
      serviceClient,
      readText(row, "logo_path", CLUBS_TABLE),
    ),
    // Una columna `date` llega como YYYY-MM-DD, que es como la usa el dominio.
    seasonStartsOn: readText(row, "season_starts_on", CLUBS_TABLE),
  };
}

async function findClubSettings(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<ClubSettings> {
  const { data, error } = await serviceClient
    .from(CLUBS_TABLE)
    .select(SETTINGS_COLUMNS)
    .eq("id", clubId)
    .single<Row>();
  if (error) {
    throw new Error(
      `No se pudo leer la configuración del club ${clubId}: ${error.message}`,
    );
  }
  return toClubSettings(serviceClient, data);
}

/**
 * La escritura sólo casa si la fila sigue teniendo lo que el Admin tenía
 * delante. Sin fila de vuelta, alguien la cambió entretanto: el club no
 * desaparece, porque quien llama es miembro suyo.
 */
async function updateClubIdentity(
  serviceClient: SupabaseClient,
  clubId: string,
  write: { readonly expected: ClubIdentity; readonly identity: ClubIdentity },
): Promise<ClubIdentityUpdate> {
  const { expected, identity } = write;
  const matchingName = serviceClient
    .from(CLUBS_TABLE)
    .update({
      name: identity.name,
      initials: identity.initials,
      accent_color: identity.accentColor,
      season_starts_on: identity.seasonStartsOn,
    })
    .eq("id", clubId)
    .eq("name", expected.name)
    .eq("accent_color", expected.accentColor);
  // `eq` con null no casa con nada en SQL: un nulo esperado se pide con `is`.
  const matchingInitials =
    expected.initials === null
      ? matchingName.is("initials", null)
      : matchingName.eq("initials", expected.initials);
  const matchingRow =
    expected.seasonStartsOn === null
      ? matchingInitials.is("season_starts_on", null)
      : matchingInitials.eq("season_starts_on", expected.seasonStartsOn);
  const { data, error } = await matchingRow
    .select(SETTINGS_COLUMNS)
    .maybeSingle<Row>();
  if (error) {
    throw new Error(
      `No se pudo guardar la configuración del club ${clubId}: ${error.message}`,
    );
  }
  return data === null
    ? { kind: "changed_meanwhile" }
    : { kind: "updated", settings: toClubSettings(serviceClient, data) };
}

export function createClubSettingsGateways(
  serviceClient: SupabaseClient,
): ClubSettingsGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    settings: {
      findClubSettings: (clubId) => findClubSettings(serviceClient, clubId),
      updateClubIdentity: (clubId, write) =>
        updateClubIdentity(serviceClient, clubId, write),
    },
    audit: createSupabaseAuditLogWriter(serviceClient),
  };
}

export type ClubSettingsGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: ClubSettingsGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición del endpoint. Devuelve las variables que faltan en vez
 * de lanzar, como las demás. */
export function createSupabaseClubSettingsGateways(
  env: Environment,
): ClubSettingsGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createClubSettingsGateways(createServiceRoleClient(env)),
  };
}
