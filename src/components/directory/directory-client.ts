import { z } from "zod";
import {
  type ApiRequestFailure,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { ACCOUNT_STATUSES } from "@/lib/auth/account-status";
import { ROLES } from "@/lib/auth/roles";
import { DIRECTORY_API_PATH } from "@/lib/auth/routes";
import type {
  DirectoryListing,
  DirectoryQuery,
} from "@/lib/directory/directory";
import {
  DIRECTION_QUERY_PARAM,
  INCLUDE_INACTIVE_QUERY_PARAM,
  ROLE_QUERY_PARAM,
  SEARCH_QUERY_PARAM,
  SORT_QUERY_PARAM,
} from "@/lib/directory/directory-query";
import { EXPERIENCE_LEVELS } from "@/lib/members/profile-fields";
import type { Translator } from "@/lib/i18n/translator";
import { namedPositionSchema } from "@/components/club/positions-client";

/**
 * Lo que la pantalla del directorio le pide a `GET /api/v1/directory` (#238) y
 * cómo reduce la respuesta a algo que pintar.
 *
 * Nada habla con la base: el endpoint es el producto, y la aplicación nativa
 * de Release 2 va a usar este mismo camino (CON-002). Buscar, filtrar y
 * ordenar los hace el servidor, así que aquí sólo se arma la consulta y se
 * estrecha lo que responde. De un error se guarda el código y no la frase,
 * para que el aviso cambie de idioma con el interruptor (E17).
 */

const memberSchema = z.object({
  userId: z.uuid(),
  fullName: z.string(),
  country: z.string().nullable(),
  experienceLevel: z.enum(EXPERIENCE_LEVELS).nullable(),
  role: z.enum(ROLES),
  position: namedPositionSchema.nullable(),
  status: z.enum(ACCOUNT_STATUSES),
  // Sólo una dirección web: la pantalla la pone tal cual en una imagen.
  photoUrl: z.url({ protocol: /^https?$/ }).nullable(),
});

const adminMemberSchema = memberSchema.extend({
  aufNumber: z.string().nullable(),
  aufExpiry: z.string().nullable(),
  isAufVerified: z.boolean(),
  isAufExpired: z.boolean(),
});

/** La misma unión discriminada que sirve el endpoint: quien la consume no
 * adivina por la presencia de un campo si le toca dibujar lo del Admin. */
const listingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("member"), members: z.array(memberSchema) }),
  z.object({ kind: z.literal("admin"), members: z.array(adminMemberSchema) }),
]);

const responseSchema = z.object({ data: listingSchema });

export type DirectoryFailure = ApiRequestFailure;

export type DirectoryLoad =
  | { readonly kind: "loaded"; readonly listing: DirectoryListing }
  | DirectoryFailure;

/** El camino con la consulta puesta. Sólo viajan los parámetros que dicen
 * algo: un `?role=` vacío no es "sin filtrar", es un rol que no existe. */
export function directoryPath(query: DirectoryQuery): string {
  const params = new URLSearchParams({
    [SORT_QUERY_PARAM]: query.sort,
    [DIRECTION_QUERY_PARAM]: query.direction,
  });
  if (query.search !== null) {
    params.set(SEARCH_QUERY_PARAM, query.search);
  }
  if (query.role !== null) {
    params.set(ROLE_QUERY_PARAM, query.role);
  }
  if (query.includeInactive) {
    params.set(INCLUDE_INACTIVE_QUERY_PARAM, "true");
  }
  return `${DIRECTORY_API_PATH}?${params.toString()}`;
}

/** Nunca rechaza: `requestApi` atrapa el fallo de red y un cuerpo que no
 * cuadra sale como fallo, no como excepción. Quien la llama puede leer el
 * resultado sin envolverlo en un `catch`. */
export async function loadDirectory(
  query: DirectoryQuery,
): Promise<DirectoryLoad> {
  const read = readApiPayload(
    await requestApi(directoryPath(query)),
    responseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", listing: read.value.data };
}

/** Por qué no se pudo leer el directorio, en el idioma de la pantalla. Sólo
 * se lee, así que ninguna regla de negocio lo rechaza: lo que queda es haber
 * perdido la sesión, no poder verlo, o un fallo del que sólo cabe reintentar. */
export function describeDirectoryFailure(
  translate: Translator,
  { failure }: DirectoryFailure,
): string {
  switch (failure) {
    case "network":
      return translate("auth.error.network");
    case "unauthenticated":
      return translate("directory.error.signInRequired");
    case "forbidden":
      return translate("directory.error.forbidden");
    default:
      return translate("directory.error.unexpected");
  }
}
