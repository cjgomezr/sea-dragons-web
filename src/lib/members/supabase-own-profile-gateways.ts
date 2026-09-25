import type { SupabaseClient } from "@supabase/supabase-js";
import { readRequiredText, readText } from "@/lib/auth/supabase-auth-gateways";
import type { ClubPositionsGateway } from "@/lib/club/club-positions";
import { cachedClubPositions } from "@/lib/club/supabase-club-positions";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  OwnAuf,
  OwnAufChange,
  OwnProfileFields,
  OwnProfileGateways,
  OwnProfileUpdateResult,
  StoredOwnProfile,
} from "./own-profile";
import { parseExperienceLevel, parseGender } from "./profile-fields";

/**
 * Adaptador entre el perfil propio (#241) y Supabase.
 *
 * Leer sirve con cualquier cliente: la policy `members_select_own` de
 * `0003_members.sql` ya deja a cada miembro ver su fila, así que la pantalla
 * lee con la sesión de quien la abre. Escribir va por la llave de servicio a
 * propósito: `authenticated` no tiene `update` sobre `members`, y así el rol,
 * la verificación del AUF o el estado no se pueden cambiar atacando la base
 * directamente. El servidor identifica a quien pide por su cookie y escribe
 * sólo su fila, y sólo las cinco columnas del perfil y el AUF propuesto
 * (#274), que siempre se escribe sin verificar.
 */

const MEMBERS_TABLE = "members";
const PROFILE_COLUMNS =
  "full_name, country, position_id, experience_level, gender, auf_number, auf_expiry, auf_verified_at, joined_on, club_id";

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

/** El `check` `members_auf_verified_requires_number` de `0021` garantiza
 * que no haya verificación sin número. */
function toOwnAuf(row: Row): OwnAuf {
  const number = readText(row, "auf_number", MEMBERS_TABLE);
  if (number === null) {
    return { status: "none" };
  }
  return {
    status:
      readText(row, "auf_verified_at", MEMBERS_TABLE) === null
        ? "pending"
        : "verified",
    number,
    // Las columnas `date` llegan como YYYY-MM-DD.
    expiry: readText(row, "auf_expiry", MEMBERS_TABLE),
  };
}

function toStoredOwnProfile(row: Row): StoredOwnProfile {
  return {
    profile: {
      fullName: readRequiredText(row, "full_name", MEMBERS_TABLE),
      country: readText(row, "country", MEMBERS_TABLE),
      positionId: readText(row, "position_id", MEMBERS_TABLE),
      experienceLevel: readOptionalCatalogValue(
        row,
        "experience_level",
        parseExperienceLevel,
      ),
      gender: readOptionalCatalogValue(row, "gender", parseGender),
      auf: toOwnAuf(row),
    },
    joinedOn: readRequiredText(row, "joined_on", MEMBERS_TABLE),
    clubId: readRequiredText(row, "club_id", MEMBERS_TABLE),
  };
}

function toProfileColumns(
  fields: OwnProfileFields,
  auf: OwnAufChange,
): Record<string, string | null> {
  const profileColumns = {
    full_name: fields.fullName,
    country: fields.country,
    // La clave foránea compuesta de `0025` rechaza una posición de otro club
    // aunque el dominio la dejara pasar.
    position_id: fields.positionId,
    experience_level: fields.experienceLevel,
    gender: fields.gender,
  };
  return auf.kind === "keep"
    ? profileColumns
    : {
        ...profileColumns,
        auf_number: auf.number,
        auf_expiry: auf.expiry,
        auf_verified_at: null,
      };
}

async function findOwnProfile(
  client: SupabaseClient,
  userId: string,
): Promise<StoredOwnProfile | null> {
  const { data, error } = await client
    .from(MEMBERS_TABLE)
    .select(PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`No se pudo leer el perfil de ${userId}: ${error.message}`);
  }
  return data === null ? null : toStoredOwnProfile(data);
}

/** Una propuesta lleva la condición de que el AUF siga sin verificar en el
 * mismo `update`: si un Admin lo verificó entre la lectura y la escritura, no
 * toca ninguna fila, y una segunda lectura dice si fue eso o si la fila ya no
 * está. */
async function updateOwnProfile(
  client: SupabaseClient,
  userId: string,
  change: { readonly fields: OwnProfileFields; readonly auf: OwnAufChange },
): Promise<OwnProfileUpdateResult> {
  const update = client
    .from(MEMBERS_TABLE)
    .update(toProfileColumns(change.fields, change.auf))
    .eq("user_id", userId);
  const { data, error } = await (
    change.auf.kind === "propose" ? update.is("auf_verified_at", null) : update
  )
    .select(PROFILE_COLUMNS)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo guardar el perfil de ${userId}: ${error.message}`,
    );
  }
  if (data !== null) {
    return { kind: "updated", profile: toStoredOwnProfile(data).profile };
  }
  return change.auf.kind === "propose" &&
    (await findOwnProfile(client, userId)) !== null
    ? { kind: "auf_verified" }
    : { kind: "member_not_found" };
}

/** Las posiciones van aparte: la pantalla y la API las leen de la caché, y
 * un test de integración que acaba de archivar una las quiere al día. */
export function createOwnProfileGateways(
  client: SupabaseClient,
  positions: ClubPositionsGateway,
): OwnProfileGateways {
  return {
    positions,
    profiles: {
      findOwnProfile: (userId) => findOwnProfile(client, userId),
      updateOwnProfile: (userId, fields, auf) =>
        updateOwnProfile(client, userId, { fields, auf }),
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
    gateways: createOwnProfileGateways(
      createServiceRoleClient(env),
      cachedClubPositions,
    ),
  };
}
