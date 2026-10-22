import { z } from "zod";
import {
  type ApiRequestFailure,
  type ApiRequestOutcome,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { GROUPS_API_PATH } from "@/lib/auth/routes";
import { ISO_WEEKDAYS } from "@/lib/events/event-occurrences";
import type { GroupAudience } from "@/lib/groups/group-audience";
import type {
  GroupCandidate,
  GroupRosterMember,
  RejectedMember,
} from "@/lib/groups/group-members";
import {
  GROUP_NAME_MAX_LENGTH,
  type Group,
  type GroupOverview,
} from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Lo que la pantalla Grupos le pide a la API v1 (#226, #227 y #827) y cómo reduce
 * cada respuesta a algo que pintar.
 *
 * Nada habla con la base: los endpoints son el producto, y la aplicación
 * nativa de Release 2 va a usar estos mismos caminos (CON-002). De un error se
 * guarda el código y no la frase, para que el aviso cambie de idioma con el
 * interruptor (E17).
 */

/** El id es el uuid de la fila, y de ahí sale el camino de la petición
 * siguiente: uno con una barra compondría una URL distinta de la pretendida. */
const groupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  memberCount: z.number(),
});

/** La vista previa y el uso de cada grupo de la lista (D4 de E32). */
const groupOverviewSchema = groupSchema.extend({
  usage: z.object({ events: z.number(), posts: z.number() }),
  previewMembers: z.array(
    z.object({
      id: z.uuid(),
      fullName: z.string(),
      photoUrl: z.string().nullable(),
    }),
  ),
});

const groupsSchema = z.object({
  data: z.object({ groups: z.array(groupSchema) }),
});

const groupOverviewsSchema = z.object({
  data: z.object({ groups: z.array(groupOverviewSchema) }),
});

const singleGroupSchema = z.object({ data: groupSchema });

const memberSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  isPendingActivation: z.boolean(),
});

/** La posición y la foto de cada socio de la lista (#826). */
const rosterMemberSchema = memberSchema.extend({
  positionName: z.string().nullable(),
  photoUrl: z.string().nullable(),
});

const candidateSchema = rosterMemberSchema.extend({
  groupCount: z.number(),
});

const membersSchema = z.object({
  data: z.object({ members: z.array(rosterMemberSchema) }),
});

const candidatesSchema = z.object({
  data: z.object({ candidates: z.array(candidateSchema) }),
});

const bulkAssignmentSchema = z.object({
  data: z.object({
    members: z.array(rosterMemberSchema),
    candidates: z.array(candidateSchema),
    rejected: z.array(
      z.object({
        userId: z.string(),
        reason: z.enum(["inactive", "not_in_club"]),
      }),
    ),
  }),
});

const weekdaySchema = z.union(ISO_WEEKDAYS.map((day) => z.literal(day)));

const audienceEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("event"),
    id: z.uuid(),
    title: z.string(),
    startsOn: z.string(),
    startTime: z.string(),
  }),
  z.object({
    kind: z.literal("series"),
    id: z.uuid(),
    title: z.string(),
    weekdays: z.array(weekdaySchema),
    startTime: z.string(),
    nextSession: z.object({ id: z.uuid(), startsOn: z.string() }),
  }),
]);

const audiencePostSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  publishedAt: z.string(),
});

const audienceSchema = z.object({
  data: z.object({
    events: z.object({
      items: z.array(audienceEventSchema),
      total: z.number(),
    }),
    posts: z.object({ items: z.array(audiencePostSchema), total: z.number() }),
  }),
});

export type GroupsFailure = ApiRequestFailure;

export type GroupsLoad =
  | { readonly kind: "loaded"; readonly groups: readonly Group[] }
  | GroupsFailure;

export type GroupOverviewsLoad =
  | { readonly kind: "loaded"; readonly groups: readonly GroupOverview[] }
  | GroupsFailure;

export type GroupSaved =
  { readonly kind: "saved"; readonly group: Group } | GroupsFailure;

export type GroupDeleted = { readonly kind: "deleted" } | GroupsFailure;

/** Un candidato del selector. Su `groupCount` es `null` cuando acaba de salir
 * del grupo desde esta pantalla: en cuántos otros grupos está no lo sabe. */
export type RosterCandidate = GroupRosterMember & {
  readonly groupCount: number | null;
};

export type GroupRoster = {
  readonly members: readonly GroupRosterMember[];
  readonly candidates: readonly RosterCandidate[];
};

export type GroupRosterLoad =
  ({ readonly kind: "loaded" } & GroupRoster) | GroupsFailure;

/** El alta masiva (D3 de E32): las dos listas ya actualizadas y quién no
 * entró. */
export type MembersAssigned =
  | {
      readonly kind: "assigned";
      readonly members: readonly GroupRosterMember[];
      readonly candidates: readonly GroupCandidate[];
      readonly rejected: readonly RejectedMember[];
    }
  | GroupsFailure;

export type GroupAudienceLoad =
  { readonly kind: "loaded"; readonly audience: GroupAudience } | GroupsFailure;

export type MemberRemoved = { readonly kind: "removed" } | GroupsFailure;

function groupPath(groupId: string): string {
  return `${GROUPS_API_PATH}/${groupId}`;
}

function membershipPath(groupId: string, userId: string): string {
  return `${groupPath(groupId)}/members/${userId}`;
}

function writeName(
  path: string,
  method: "POST" | "PATCH",
  name: string,
): Promise<ApiRequestOutcome> {
  return requestApi(path, {
    method,
    headers: JSON_REQUEST_HEADERS,
    body: JSON.stringify({ name }),
  });
}

async function saveGroup(
  path: string,
  method: "POST" | "PATCH",
  name: string,
): Promise<GroupSaved> {
  const read = readApiPayload(
    await writeName(path, method, name),
    singleGroupSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "saved", group: read.value.data };
}

/** Los grupos con nombre y conteo: lo que piden las pantallas que los
 * ofrecen como audiencia o los asignan a un socio. */
export async function loadGroups(): Promise<GroupsLoad> {
  const read = readApiPayload(await requestApi(GROUPS_API_PATH), groupsSchema);
  return read.kind === "failed"
    ? read
    : { kind: "loaded", groups: read.value.data.groups };
}

/** La misma lista con el uso y la vista previa de cada grupo, que sólo pinta
 * la pantalla Grupos (D4 de E32). */
export async function loadGroupOverviews(): Promise<GroupOverviewsLoad> {
  const read = readApiPayload(
    await requestApi(GROUPS_API_PATH),
    groupOverviewsSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", groups: read.value.data.groups };
}

export function createGroup(name: string): Promise<GroupSaved> {
  return saveGroup(GROUPS_API_PATH, "POST", name);
}

export function renameGroup(
  groupId: string,
  name: string,
): Promise<GroupSaved> {
  return saveGroup(groupPath(groupId), "PATCH", name);
}

export async function deleteGroup(groupId: string): Promise<GroupDeleted> {
  const outcome = await requestApi(groupPath(groupId), { method: "DELETE" });
  return outcome.kind === "failed" ? outcome : { kind: "deleted" };
}

/** Quiénes están dentro y quiénes pueden entrar, en una sola espera: la
 * pantalla no sirve de nada con sólo una de las dos listas. */
export async function loadGroupRoster(
  groupId: string,
): Promise<GroupRosterLoad> {
  const [members, candidates] = await Promise.all([
    requestApi(`${groupPath(groupId)}/members`),
    requestApi(`${groupPath(groupId)}/candidates`),
  ]);
  const readMembers = readApiPayload(members, membersSchema);
  if (readMembers.kind === "failed") {
    return readMembers;
  }
  const readCandidates = readApiPayload(candidates, candidatesSchema);
  if (readCandidates.kind === "failed") {
    return readCandidates;
  }
  return {
    kind: "loaded",
    members: readMembers.value.data.members,
    candidates: readCandidates.value.data.candidates,
  };
}

export async function assignMembers(
  groupId: string,
  userIds: readonly string[],
): Promise<MembersAssigned> {
  const read = readApiPayload(
    await requestApi(`${groupPath(groupId)}/members`, {
      method: "POST",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify({ userIds }),
    }),
    bulkAssignmentSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "assigned", ...read.value.data };
}

export async function loadGroupAudience(
  groupId: string,
): Promise<GroupAudienceLoad> {
  const read = readApiPayload(
    await requestApi(`${groupPath(groupId)}/audience`),
    audienceSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", audience: read.value.data };
}

export async function removeMember(
  groupId: string,
  userId: string,
): Promise<MemberRemoved> {
  const outcome = await requestApi(membershipPath(groupId, userId), {
    method: "DELETE",
  });
  return outcome.kind === "failed" ? outcome : { kind: "removed" };
}

/**
 * Un 404 de cualquiera de estos caminos deja el grupo fuera de uso desde esta
 * pantalla: lo borró otro mientras la tenía abierta. Quitar un socio y
 * añadir a varios sólo lo responden por el grupo: quien ya no está en el club
 * vuelve en `rejected` (D3 de E32). El grupo sale de la lista y se vuelve a
 * ella, que es lo que pide el PRD de E4.
 */
export function isGroupGone(failure: GroupsFailure): boolean {
  return failure.failure === "not_found";
}

/** El mismo fallo, para cuando la pantalla ya sabe que el grupo se fue y sólo
 * le falta decirlo con la frase de siempre. */
export const GROUP_GONE: GroupsFailure = {
  kind: "failed",
  failure: "not_found",
  reason: null,
};

/** Si el fallo dice algo que quien mira puede hacer distinto: reconectar,
 * volver a entrar o pedir el permiso. Un 500 no: ahí sólo queda reintentar, y
 * el aviso de la pantalla ya lo ofrece. */
export function hasActionableCause({ failure }: GroupsFailure): boolean {
  return (
    failure === "network" ||
    failure === "unauthenticated" ||
    failure === "forbidden"
  );
}

/** Lo que el servidor puede responder que no, en el idioma de la pantalla. */
export function describeGroupsFailure(
  translate: Translator,
  { failure }: GroupsFailure,
): string {
  switch (failure) {
    case "network":
      return translate("auth.error.network");
    case "conflict":
      return translate("groups.error.nameTaken");
    case "validation_error":
      return translate("groups.error.invalidName", {
        max: GROUP_NAME_MAX_LENGTH,
      });
    // La única regla que estos endpoints nombran: un socio dado de baja no se
    // asigna (RF-6). Crear, renombrar y borrar no responden 422 nunca.
    case "business_rule":
      return translate("groups.error.memberInactive");
    case "not_found":
      return translate("groups.error.groupGone");
    case "unauthenticated":
      return translate("groups.error.signInRequired");
    case "forbidden":
      return translate("groups.error.forbidden");
    default:
      return translate("groups.error.unexpected");
  }
}
