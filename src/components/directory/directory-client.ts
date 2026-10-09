import { z } from "zod";
import {
  type ApiRequestFailure,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { ACCOUNT_STATUSES } from "@/lib/auth/account-status";
import { ROLES } from "@/lib/auth/roles";
import { DIRECTORY_API_PATH } from "@/lib/auth/routes";
import { MEMBERSHIP_STATUSES } from "@/lib/membership/membership";
import {
  DIRECTORY_FILTERS,
  DIRECTORY_FILTER_FORBIDDEN_REASON,
  type DirectoryListing,
  type DirectoryQuery,
} from "@/lib/directory/directory";
import {
  DIRECTION_QUERY_PARAM,
  SORT_QUERY_PARAM,
  writeDirectoryQuery,
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

/** La asistencia de un miembro (#394): su porcentaje y su total, o sin
 * datos. La ficha del Admin la lee con la misma forma. */
export const memberAttendanceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("rate"),
    percent: z.number().int(),
    sessions: z.number().int(),
  }),
  z.object({ kind: z.literal("no_data") }),
]);

const memberSchema = z.object({
  userId: z.uuid(),
  fullName: z.string(),
  country: z.string().nullable(),
  experienceLevel: z.enum(EXPERIENCE_LEVELS).nullable(),
  role: z.enum(ROLES),
  position: namedPositionSchema.nullable(),
  status: z.enum(ACCOUNT_STATUSES),
  invitedOn: z.string().nullable(),
  // Sólo una dirección web: la pantalla la pone tal cual en una imagen.
  photoUrl: z.url({ protocol: /^https?$/ }).nullable(),
  attendance: memberAttendanceSchema,
});

/** El contacto de emergencia de un socio (#499), o `null` si no lo dio. La
 * ficha del Admin lo lee con la misma forma. */
export const emergencyContactSchema = z
  .object({ name: z.string(), phone: z.string(), relationship: z.string() })
  .nullable();

/** Todo el contacto, que sólo reciben Admin y Committee (D5). */
const memberContactShape = {
  email: z.string(),
  phone: z.string().nullable(),
  emergencyContact: emergencyContactSchema,
};

const committeeMemberSchema = memberSchema.extend(memberContactShape);

const coachMemberSchema = memberSchema.extend({
  isEvaluated: z.boolean(),
  emergencyContact: emergencyContactSchema,
});

/** El estado de la membresía del chip del Admin (#453), o `null` sin ella. */
export const membershipStatusSchema = z.enum(MEMBERSHIP_STATUSES).nullable();

const adminMemberSchema = coachMemberSchema.extend({
  ...memberContactShape,
  aufNumber: z.string().nullable(),
  aufExpiry: z.string().nullable(),
  isAufVerified: z.boolean(),
  isAufExpired: z.boolean(),
  isAufExpiring: z.boolean(),
  membershipStatus: membershipStatusSchema,
});

/** La misma unión discriminada que sirve el endpoint: quien la consume no
 * adivina por la presencia de un campo si le toca dibujar lo del Admin. */
const availableFiltersSchema = z.array(z.enum(DIRECTORY_FILTERS));

/** Lo que llevan las cuatro vistas además de sus socios. */
const listingShape = {
  availableFilters: availableFiltersSchema,
  total: z.number().int().nonnegative(),
};

const listingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("member"),
    members: z.array(memberSchema),
    ...listingShape,
  }),
  z.object({
    kind: z.literal("committee"),
    members: z.array(committeeMemberSchema),
    ...listingShape,
  }),
  z.object({
    kind: z.literal("coach"),
    members: z.array(coachMemberSchema),
    ...listingShape,
  }),
  z.object({
    kind: z.literal("admin"),
    members: z.array(adminMemberSchema),
    ...listingShape,
  }),
]);

const responseSchema = z.object({ data: listingSchema });

export type DirectoryFailure = ApiRequestFailure;

export type DirectoryLoad =
  | { readonly kind: "loaded"; readonly listing: DirectoryListing }
  | DirectoryFailure;

/** El camino con la consulta puesta, del directorio o de su exportación
 * (#500), que lee la misma. Sólo viajan los filtros que dicen algo: un
 * `?role=` vacío no es "sin filtrar", es un rol que no existe. El orden va
 * siempre, para que la petición diga entera qué lista espera. */
export function directoryPath(
  query: DirectoryQuery,
  basePath: string = DIRECTORY_API_PATH,
): string {
  const params = writeDirectoryQuery(query);
  params.set(SORT_QUERY_PARAM, query.sort);
  params.set(DIRECTION_QUERY_PARAM, query.direction);
  return `${basePath}?${params.toString()}`;
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
  { failure, reason }: DirectoryFailure,
): string {
  if (reason === DIRECTORY_FILTER_FORBIDDEN_REASON) {
    return translate("directory.error.filterForbidden");
  }
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
