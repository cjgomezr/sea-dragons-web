import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAccountStatus } from "@/lib/auth/account-status";
import { parseRole } from "@/lib/auth/roles";
import { readRequiredText, readText } from "@/lib/auth/supabase-auth-gateways";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { createMemberAttendanceGateway } from "@/lib/attendance/supabase-attendance-stats";
import type { ClubPositionsGateway } from "@/lib/club/club-positions";
import { cachedClubPositions } from "@/lib/club/supabase-club-positions";
import {
  MEMBERSHIP_STANDING_EMBED,
  readEmbeddedMembershipStatus,
} from "@/lib/membership/supabase-membership-gateways";
import { parseExperienceLevel } from "@/lib/members/profile-fields";
import { signProfilePhotoUrls } from "@/lib/members/supabase-profile-photo-gateways";
import {
  CONTACT_COLUMNS,
  readProfileContact,
} from "@/lib/members/supabase-profile-contact";
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
// Sólo el id de la evaluación: que exista es lo único que el directorio
// cuenta (#324), y así ninguna nota sale de la base por este camino.
// La membresía va por el `left join` del chip del Admin (#453). De los grupos
// basta el id: el filtro por grupo (#497) no pinta ningún nombre. El
// correo y el contacto (#499) se leen siempre; el dominio decide a quién
// le salen.
export const DIRECTORY_COLUMNS = `user_id, full_name, country, experience_level, role, position_id, account_status, auf_number, auf_expiry, auf_verified_at, photo_path, email, ${CONTACT_COLUMNS}, member_evaluations(id), group_memberships(group_id), ${MEMBERSHIP_STANDING_EMBED}`;
const EVALUATIONS_RELATION = "member_evaluations";
const GROUP_MEMBERSHIPS_RELATION = "group_memberships";
const MEMBERSHIPS_RELATION = "memberships";

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

/** PostgREST sirve la evaluación como lista, igual que a la lista de
 * Evaluaciones: la clave foránea es compuesta y no la ve como uno a uno. Una
 * restricción única garantiza que haya como mucho una. */
function hasEvaluation(row: Row): boolean {
  const evaluations = row[EVALUATIONS_RELATION];
  if (!Array.isArray(evaluations)) {
    throw new Error(
      `${MEMBERS_TABLE}.${EVALUATIONS_RELATION} no llegó como lista: el esquema cambió sin que este archivo se enterara.`,
    );
  }
  return evaluations.length > 0;
}

/** Las pertenencias llegan como lista, una fila por grupo. */
function readGroupIds(row: Row): readonly string[] {
  const memberships = row[GROUP_MEMBERSHIPS_RELATION];
  if (!Array.isArray(memberships)) {
    throw new Error(
      `${MEMBERS_TABLE}.${GROUP_MEMBERSHIPS_RELATION} no llegó como lista: el esquema cambió sin que este archivo se enterara.`,
    );
  }
  return memberships.map((membership: Row) =>
    readRequiredText(membership, "group_id", GROUP_MEMBERSHIPS_RELATION),
  );
}

/** `now` decide si una exención con fecha de fin ya venció (#453). */
export function toDirectoryMemberRecord(
  row: Row,
  now: Date,
): DirectoryMemberRecord {
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
    positionId: readText(row, "position_id", MEMBERS_TABLE),
    status: readCatalogValue(row, "account_status", parseAccountStatus),
    aufNumber: readText(row, "auf_number", MEMBERS_TABLE),
    // Una columna `date` llega como YYYY-MM-DD, que es el formato con el que
    // el dominio compara el vencimiento contra el día del club.
    aufExpiry: readText(row, "auf_expiry", MEMBERS_TABLE),
    isAufVerified: readText(row, "auf_verified_at", MEMBERS_TABLE) !== null,
    photoPath: readText(row, "photo_path", MEMBERS_TABLE),
    isEvaluated: hasEvaluation(row),
    membershipStatus: readEmbeddedMembershipStatus(
      row[MEMBERSHIPS_RELATION],
      now,
    ),
    groupIds: readGroupIds(row),
    email: readRequiredText(row, "email", MEMBERS_TABLE),
    ...readProfileContact(row),
  };
}

/** Las posiciones van aparte: la API las lee de la caché, y un test de
 * integración que acaba de sembrar un club las quiere al día. */
export function createDirectoryGateways(
  serviceClient: SupabaseClient,
  positions: ClubPositionsGateway,
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
        const now = new Date();
        return data.map((row) => toDirectoryMemberRecord(row, now));
      },
    },
    positions,
    photos: {
      signPhotoUrls: (photoPaths) =>
        signProfilePhotoUrls(serviceClient, photoPaths),
    },
    attendance: createMemberAttendanceGateway(serviceClient),
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
    gateways: createDirectoryGateways(
      createServiceRoleClient(env),
      cachedClubPositions,
    ),
  };
}
