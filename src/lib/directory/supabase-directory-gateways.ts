import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAccountStatus } from "@/lib/auth/account-status";
import { parseRole } from "@/lib/auth/roles";
import { readRequiredText, readText } from "@/lib/auth/supabase-auth-gateways";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import {
  parseExperienceLevel,
  parsePosition,
} from "@/lib/members/profile-fields";
import { signProfilePhotoUrls } from "@/lib/members/supabase-profile-photo-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type { DirectoryGateways, DirectoryMemberRecord } from "./directory";

/**
 * Adaptador entre el directorio y Supabase (#238).
 *
 * Va por la llave de servicio: la policy de `0003_members.sql` deja a un socio
 * ver sólo su propia fila, y el directorio es justo lo contrario. Lo lee el
 * servidor, que ya averiguó por la cookie de sesión quién pregunta y de qué
 * club, y filtra por ese club: es lo único que separa un club de otro con esta
 * llave (NFR-009).
 *
 * Se traen todas las filas del club y el dominio las filtra y las ordena. El
 * club tiene decenas de socios, no miles, y así el orden no depende del
 * collation de la base ni la búsqueda sin acentos de una extensión de
 * Postgres.
 */

const MEMBERS_TABLE = "members";
const DIRECTORY_COLUMNS =
  "user_id, full_name, country, experience_level, role, position, account_status, auf_number, auf_expiry, photo_path";

type Environment = Readonly<Record<string, string | undefined>>;

type Row = Record<string, unknown>;

type Catalog<T> = (value: unknown) => T | null;

/** Lo que la base cierra con un `check` llega estrechado o no llega: una fila
 * con un valor que el catálogo no reconoce es un esquema que cambió sin que
 * este archivo se enterara, no una fila que haya que servir a medias. */
function readCatalogValue<T>(row: Row, column: string, catalog: Catalog<T>): T {
  const value = readRequiredText(row, column, MEMBERS_TABLE);
  const parsed = catalog(value);
  if (parsed === null) {
    throw new Error(
      `${MEMBERS_TABLE}.${column} devolvió ${value}, que el catálogo no reconoce.`,
    );
  }
  return parsed;
}

/** Las columnas del catálogo que sí pueden estar vacías: #237 las añadió
 * nulables, porque un socio de antes todavía no tiene posición ni nivel. */
function readOptionalCatalogValue<T>(
  row: Row,
  column: string,
  catalog: Catalog<T>,
): T | null {
  return readText(row, column, MEMBERS_TABLE) === null
    ? null
    : readCatalogValue(row, column, catalog);
}

function toDirectoryMemberRecord(row: Row): DirectoryMemberRecord {
  return {
    userId: readRequiredText(row, "user_id", MEMBERS_TABLE),
    fullName: readRequiredText(row, "full_name", MEMBERS_TABLE),
    country: readText(row, "country", MEMBERS_TABLE),
    experienceLevel: readOptionalCatalogValue(
      row,
      "experience_level",
      parseExperienceLevel,
    ),
    role: readCatalogValue(row, "role", parseRole),
    position: readOptionalCatalogValue(row, "position", parsePosition),
    status: readCatalogValue(row, "account_status", parseAccountStatus),
    aufNumber: readText(row, "auf_number", MEMBERS_TABLE),
    // Una columna `date` llega como YYYY-MM-DD, que es el formato con el que
    // el dominio compara el vencimiento contra el día del club.
    aufExpiry: readText(row, "auf_expiry", MEMBERS_TABLE),
    photoPath: readText(row, "photo_path", MEMBERS_TABLE),
  };
}

export function createDirectoryGateways(
  serviceClient: SupabaseClient,
): DirectoryGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    directory: {
      async findDirectoryMembers(clubId) {
        const { data, error } = await serviceClient
          .from(MEMBERS_TABLE)
          .select(DIRECTORY_COLUMNS)
          .eq("club_id", clubId);
        if (error) {
          throw new Error(
            `No se pudo leer el directorio del club ${clubId}: ${error.message}`,
          );
        }
        return data.map(toDirectoryMemberRecord);
      },
    },
    photos: {
      signPhotoUrls: (photoPaths) =>
        signProfilePhotoUrls(serviceClient, photoPaths),
    },
  };
}

export type DirectoryGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: DirectoryGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición para el endpoint del directorio. Devuelve las variables
 * que faltan en vez de lanzar, como las demás. */
export function createSupabaseDirectoryGateways(
  env: Environment,
): DirectoryGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createDirectoryGateways(createServiceRoleClient(env)),
  };
}
