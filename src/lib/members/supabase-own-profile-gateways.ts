import type { SupabaseClient } from "@supabase/supabase-js";
import { readRequiredText, readText } from "@/lib/auth/supabase-auth-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type { OwnProfile, OwnProfileGateways } from "./own-profile";
import {
  parseExperienceLevel,
  parseGender,
  parsePosition,
} from "./profile-fields";

/**
 * Adaptador entre el perfil propio (#241) y Supabase.
 *
 * Leer sirve con cualquier cliente: la policy `members_select_own` de
 * `0003_members.sql` ya deja a cada miembro ver su fila, así que la pantalla
 * lee con la sesión de quien la abre. Escribir va por la llave de servicio a
 * propósito: `authenticated` no tiene `update` sobre `members`, y así el rol,
 * el AUF o el estado no se pueden cambiar atacando la base directamente. El
 * servidor identifica a quien pide por su cookie y escribe sólo su fila, y
 * sólo las cinco columnas del perfil.
 */

const MEMBERS_TABLE = "members";
const PROFILE_COLUMNS =
  "full_name, country, position, experience_level, gender";

type Environment = Readonly<Record<string, string | undefined>>;

type Row = Record<string, unknown>;

/** Una columna con `check` que trae algo fuera del catálogo es un esquema que
 * cambió sin que este archivo se enterara: se falla en vez de servirla. */
function readOptionalCatalogValue<T>(
  row: Row,
  column: string,
  parse: (value: unknown) => T | null,
): T | null {
  const value = readText(row, column, MEMBERS_TABLE);
  if (value === null) {
    return null;
  }
  const parsed = parse(value);
  if (parsed === null) {
    throw new Error(
      `${MEMBERS_TABLE}.${column} devolvió ${value}, que el catálogo no reconoce.`,
    );
  }
  return parsed;
}

function toOwnProfile(row: Row): OwnProfile {
  return {
    fullName: readRequiredText(row, "full_name", MEMBERS_TABLE),
    country: readText(row, "country", MEMBERS_TABLE),
    position: readOptionalCatalogValue(row, "position", parsePosition),
    experienceLevel: readOptionalCatalogValue(
      row,
      "experience_level",
      parseExperienceLevel,
    ),
    gender: readOptionalCatalogValue(row, "gender", parseGender),
  };
}

export function createOwnProfileGateways(
  client: SupabaseClient,
): OwnProfileGateways {
  return {
    profiles: {
      async findOwnProfile(userId) {
        const { data, error } = await client
          .from(MEMBERS_TABLE)
          .select(PROFILE_COLUMNS)
          .eq("user_id", userId)
          .maybeSingle();
        if (error) {
          throw new Error(
            `No se pudo leer el perfil de ${userId}: ${error.message}`,
          );
        }
        return data === null ? null : toOwnProfile(data);
      },

      async updateOwnProfile(userId, profile) {
        const { data, error } = await client
          .from(MEMBERS_TABLE)
          .update({
            full_name: profile.fullName,
            country: profile.country,
            position: profile.position,
            experience_level: profile.experienceLevel,
            gender: profile.gender,
          })
          .eq("user_id", userId)
          .select(PROFILE_COLUMNS)
          .maybeSingle();
        if (error) {
          throw new Error(
            `No se pudo guardar el perfil de ${userId}: ${error.message}`,
          );
        }
        return data === null ? null : toOwnProfile(data);
      },
    },
  };
}

export type OwnProfileGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: OwnProfileGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición del endpoint, con la llave de servicio. Devuelve las
 * variables que faltan en vez de lanzar, como las demás. */
export function createSupabaseOwnProfileGateways(
  env: Environment,
): OwnProfileGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createOwnProfileGateways(createServiceRoleClient(env)),
  };
}
