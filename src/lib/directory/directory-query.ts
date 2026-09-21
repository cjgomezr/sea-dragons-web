import { z } from "zod";
import { ROLES } from "@/lib/auth/roles";
import {
  DEFAULT_DIRECTORY_QUERY,
  DIRECTORY_DIRECTIONS,
  DIRECTORY_SORTS,
  type DirectoryQuery,
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

/** `includeInactive` se escribe entero: un booleano de verdad, no "1" ni "on"
 * ni la mera presencia del parámetro. Pedir a los dados de baja es cosa de un
 * Admin (AC-040), así que no se adivina. */
const BOOLEAN_VALUES = ["true", "false"] as const;

const directoryQuerySchema = z.object({
  [SEARCH_QUERY_PARAM]: z.string().optional(),
  [ROLE_QUERY_PARAM]: z.enum(ROLES).optional(),
  [SORT_QUERY_PARAM]: z.enum(DIRECTORY_SORTS).optional(),
  [DIRECTION_QUERY_PARAM]: z.enum(DIRECTORY_DIRECTIONS).optional(),
  [INCLUDE_INACTIVE_QUERY_PARAM]: z.enum(BOOLEAN_VALUES).optional(),
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
    includeInactive:
      query[INCLUDE_INACTIVE_QUERY_PARAM] === undefined
        ? DEFAULT_DIRECTORY_QUERY.includeInactive
        : query[INCLUDE_INACTIVE_QUERY_PARAM] === "true",
  };
}
