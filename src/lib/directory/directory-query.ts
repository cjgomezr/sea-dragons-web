import { z } from "zod";
import { ROLES } from "@/lib/auth/roles";
import {
  AUF_FILTERS,
  DEFAULT_DIRECTORY_QUERY,
  DIRECTORY_DIRECTIONS,
  DIRECTORY_SORTS,
  type DirectoryPositionFilter,
  type DirectoryQuery,
  MEMBERSHIP_FILTERS,
} from "./directory";

/**
 * La consulta de `GET /api/v1/directory` (#238): de los parámetros del camino
 * a lo que el dominio entiende.
 *
 * Un valor que no está en un catálogo es una petición mal hecha y se rechaza
 * antes de leer nada, en vez de servir en silencio algo que no se preguntó.
 * Un parámetro que este endpoint no conoce se ignora: la paginación, por
 * ejemplo, no existe todavía (el club tiene decenas de socios), y `?page=2`
 * no describe una lista distinta.
 */

export const SEARCH_QUERY_PARAM = "q";
export const ROLE_QUERY_PARAM = "role";
export const SORT_QUERY_PARAM = "sort";
export const DIRECTION_QUERY_PARAM = "direction";
export const INCLUDE_INACTIVE_QUERY_PARAM = "includeInactive";
export const POSITION_QUERY_PARAM = "position";
export const GROUP_QUERY_PARAM = "group";
export const AUF_QUERY_PARAM = "auf";
export const MEMBERSHIP_QUERY_PARAM = "membership";
export const WITHOUT_PHONE_QUERY_PARAM = "withoutPhone";
export const WITHOUT_EMERGENCY_CONTACT_QUERY_PARAM = "withoutEmergencyContact";

/** El valor de `position` que pide a quien no tiene ninguna. */
const UNASSIGNED_POSITION_VALUE = "none";

/** El motivo del 400 de una consulta mal escrita (#497). */
export const INVALID_DIRECTORY_QUERY_REASON = "invalid_directory_query";

/** `includeInactive` se escribe entero: un booleano de verdad, no "1" ni "on"
 * ni la mera presencia del parámetro. Pedir a los dados de baja es cosa de un
 * Admin (AC-040), así que no se adivina. Los dos filtros de contacto (#499)
 * se escriben igual. */
const BOOLEAN_VALUES = ["true", "false"] as const;

const directoryQuerySchema = z.object({
  [SEARCH_QUERY_PARAM]: z.string().optional(),
  [ROLE_QUERY_PARAM]: z.enum(ROLES).optional(),
  [SORT_QUERY_PARAM]: z.enum(DIRECTORY_SORTS).optional(),
  [DIRECTION_QUERY_PARAM]: z.enum(DIRECTORY_DIRECTIONS).optional(),
  [INCLUDE_INACTIVE_QUERY_PARAM]: z.enum(BOOLEAN_VALUES).optional(),
  // Un identificador y no un nombre: el nombre de una posición cambia con el
  // idioma (#299). Uno con buena forma que no es del club no encuentra a
  // nadie, igual que un grupo de otro club: así no se sabe si existe.
  [POSITION_QUERY_PARAM]: z
    .union([z.uuid(), z.literal(UNASSIGNED_POSITION_VALUE)])
    .optional(),
  [GROUP_QUERY_PARAM]: z.uuid().optional(),
  [AUF_QUERY_PARAM]: z.enum(AUF_FILTERS).optional(),
  [MEMBERSHIP_QUERY_PARAM]: z.enum(MEMBERSHIP_FILTERS).optional(),
  [WITHOUT_PHONE_QUERY_PARAM]: z.enum(BOOLEAN_VALUES).optional(),
  [WITHOUT_EMERGENCY_CONTACT_QUERY_PARAM]: z.enum(BOOLEAN_VALUES).optional(),
});

export class InvalidDirectoryQueryError extends Error {
  constructor(parameters: readonly string[]) {
    super(`Parámetros inválidos: ${parameters.join(", ")}.`);
    this.name = "InvalidDirectoryQueryError";
  }
}

const QUERY_PARAMS = [
  SEARCH_QUERY_PARAM,
  ROLE_QUERY_PARAM,
  SORT_QUERY_PARAM,
  DIRECTION_QUERY_PARAM,
  INCLUDE_INACTIVE_QUERY_PARAM,
  POSITION_QUERY_PARAM,
  GROUP_QUERY_PARAM,
  AUF_QUERY_PARAM,
  MEMBERSHIP_QUERY_PARAM,
  WITHOUT_PHONE_QUERY_PARAM,
  WITHOUT_EMERGENCY_CONTACT_QUERY_PARAM,
] as const;

/** Sólo los parámetros que el endpoint conoce, y sin los que no llegaron: un
 * `null` de `URLSearchParams` no es un valor vacío que haya que validar. */
function readQueryParams(
  searchParams: URLSearchParams,
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const name of QUERY_PARAMS) {
    const value = searchParams.get(name);
    if (value !== null) {
      params[name] = value;
    }
  }
  return params;
}

/** Un nombre de sólo espacios no filtra nada: quien borra lo que escribió en
 * la caja de búsqueda espera volver a ver el club entero. */
function readSearch(value: string | undefined): string | null {
  const search = value?.trim() ?? "";
  return search === "" ? null : search;
}

/** Un booleano que no llegó es el valor por defecto. */
function readFlag(
  value: (typeof BOOLEAN_VALUES)[number] | undefined,
  fallback: boolean,
): boolean {
  return value === undefined ? fallback : value === "true";
}

function readPosition(
  value: string | undefined,
): DirectoryPositionFilter | null {
  if (value === undefined) {
    return DEFAULT_DIRECTORY_QUERY.position;
  }
  return value === UNASSIGNED_POSITION_VALUE
    ? { kind: "unassigned" }
    : { kind: "position", positionId: value };
}

/** Los socios marcados de una exportación (#552): uno por parámetro, como
 * `?member=a&member=b`. No es parte de la consulta de la pantalla, que se
 * comparte por la dirección: marcar es de un momento. */
export const SELECTED_MEMBER_QUERY_PARAM = "member";

/** Los socios marcados, sin repetidos, o `null` si no se marcó ninguno: la
 * exportación es entonces la de la lista filtrada entera. */
export function parseSelectedMembers(
  searchParams: URLSearchParams,
): readonly string[] | null {
  const userIds = [
    ...new Set(searchParams.getAll(SELECTED_MEMBER_QUERY_PARAM)),
  ];
  if (userIds.length === 0) {
    return null;
  }
  if (!userIds.every((userId) => z.uuid().safeParse(userId).success)) {
    throw new InvalidDirectoryQueryError([SELECTED_MEMBER_QUERY_PARAM]);
  }
  return userIds;
}

export function parseDirectoryQuery(
  searchParams: URLSearchParams,
): DirectoryQuery {
  const parsed = directoryQuerySchema.safeParse(readQueryParams(searchParams));
  if (!parsed.success) {
    throw new InvalidDirectoryQueryError(
      parsed.error.issues.map((issue) => issue.path.join(".")),
    );
  }

  const query = parsed.data;
  return {
    search: readSearch(query[SEARCH_QUERY_PARAM]),
    role: query[ROLE_QUERY_PARAM] ?? DEFAULT_DIRECTORY_QUERY.role,
    sort: query[SORT_QUERY_PARAM] ?? DEFAULT_DIRECTORY_QUERY.sort,
    direction:
      query[DIRECTION_QUERY_PARAM] ?? DEFAULT_DIRECTORY_QUERY.direction,
    includeInactive: readFlag(
      query[INCLUDE_INACTIVE_QUERY_PARAM],
      DEFAULT_DIRECTORY_QUERY.includeInactive,
    ),
    position: readPosition(query[POSITION_QUERY_PARAM]),
    groupId: query[GROUP_QUERY_PARAM] ?? DEFAULT_DIRECTORY_QUERY.groupId,
    auf: query[AUF_QUERY_PARAM] ?? DEFAULT_DIRECTORY_QUERY.auf,
    membership:
      query[MEMBERSHIP_QUERY_PARAM] ?? DEFAULT_DIRECTORY_QUERY.membership,
    withoutPhone: readFlag(
      query[WITHOUT_PHONE_QUERY_PARAM],
      DEFAULT_DIRECTORY_QUERY.withoutPhone,
    ),
    withoutEmergencyContact: readFlag(
      query[WITHOUT_EMERGENCY_CONTACT_QUERY_PARAM],
      DEFAULT_DIRECTORY_QUERY.withoutEmergencyContact,
    ),
  };
}

function writePosition(position: DirectoryPositionFilter): string {
  return position.kind === "unassigned"
    ? UNASSIGNED_POSITION_VALUE
    : position.positionId;
}

/** La consulta como parámetros, sin lo que ya es por defecto: es la
 * dirección de la pantalla (#497), que se recarga y se comparte, y
 * `parseDirectoryQuery` la vuelve a leer igual. */
export function writeDirectoryQuery(query: DirectoryQuery): URLSearchParams {
  const written: readonly (readonly [string, string | null])[] = [
    [SEARCH_QUERY_PARAM, query.search],
    [ROLE_QUERY_PARAM, query.role],
    [
      SORT_QUERY_PARAM,
      query.sort === DEFAULT_DIRECTORY_QUERY.sort ? null : query.sort,
    ],
    [
      DIRECTION_QUERY_PARAM,
      query.direction === DEFAULT_DIRECTORY_QUERY.direction
        ? null
        : query.direction,
    ],
    [INCLUDE_INACTIVE_QUERY_PARAM, query.includeInactive ? "true" : null],
    [
      POSITION_QUERY_PARAM,
      query.position === null ? null : writePosition(query.position),
    ],
    [GROUP_QUERY_PARAM, query.groupId],
    [AUF_QUERY_PARAM, query.auf],
    [MEMBERSHIP_QUERY_PARAM, query.membership],
    [WITHOUT_PHONE_QUERY_PARAM, query.withoutPhone ? "true" : null],
    [
      WITHOUT_EMERGENCY_CONTACT_QUERY_PARAM,
      query.withoutEmergencyContact ? "true" : null,
    ],
  ];
  return new URLSearchParams(
    written.flatMap(([name, value]) => (value === null ? [] : [[name, value]])),
  );
}
