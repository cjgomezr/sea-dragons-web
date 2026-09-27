import { z } from "zod";
import {
  type ApiRequestFailure,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import {
  EVENTS_API_PATH,
  EVENT_API_PATH,
  EVENT_RSVP_API_PATH,
} from "@/lib/auth/routes";
import { EVENT_TYPES } from "@/lib/events/event-creation";
import type { AgendaPage } from "@/lib/events/event-agenda";
import { RSVP_RESPONSES, type RsvpResponse } from "@/lib/events/event-rsvp";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Lo que la agenda del Calendario (#311) le pide a la API v1 (#308, #309) y
 * cómo reduce cada respuesta a algo que pintar.
 *
 * Nada habla con la base: la aplicación nativa de Release 2 va a usar estos
 * mismos caminos (CON-002). Qué eventos ve cada uno y cómo se cuentan lo
 * decide el servidor. De un error se guarda el código y no la frase, para que
 * el aviso cambie de idioma con el interruptor (E17).
 */

const CURSOR_PARAM = "cursor";

const agendaEventSchema = z.object({
  id: z.uuid(),
  startsOn: z.iso.date(),
  startTime: z.string(),
  title: z.string(),
  eventType: z.enum(EVENT_TYPES),
  location: z.string(),
  status: z.enum(["scheduled", "cancelled"]),
  seriesId: z.uuid().nullable(),
  goingCount: z.number().int().nonnegative(),
  maybeCount: z.number().int().nonnegative(),
  myResponse: z.enum(RSVP_RESPONSES).nullable(),
  inAudience: z.boolean(),
});

const agendaResponseSchema = z.object({
  data: z.object({
    events: z.array(agendaEventSchema),
    nextCursor: z.string().nullable(),
  }),
});

const tallySchema = agendaEventSchema.pick({
  goingCount: true,
  maybeCount: true,
  myResponse: true,
});

// Del detalle sólo hacen falta los conteos y la respuesta: los nombres son
// de la fila desplegada (#312).
const detailResponseSchema = z.object({ data: tallySchema });

const savedRsvpResponseSchema = z.object({
  data: z.object({ response: z.enum(RSVP_RESPONSES) }),
});

/** Lo que cambia en una fila al responder. */
export type EventTally = z.infer<typeof tallySchema>;

export type AgendaFailure = ApiRequestFailure;

export type AgendaLoad =
  { readonly kind: "loaded"; readonly page: AgendaPage } | AgendaFailure;

export type RsvpSave =
  { readonly kind: "saved"; readonly tally: EventTally } | AgendaFailure;

function agendaPath(cursor: string | null): string {
  if (cursor === null) {
    return EVENTS_API_PATH;
  }
  const params = new URLSearchParams({ [CURSOR_PARAM]: cursor });
  return `${EVENTS_API_PATH}?${params.toString()}`;
}

function eventPath(template: string, eventId: string): string {
  return template.replace("[id]", encodeURIComponent(eventId));
}

/** Una página de los próximos: la primera sin cursor, las demás con el
 * `nextCursor` de la anterior. Nunca rechaza: un fallo de red sale como
 * fallo. */
export async function loadAgenda(cursor: string | null): Promise<AgendaLoad> {
  const read = readApiPayload(
    await requestApi(agendaPath(cursor)),
    agendaResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", page: read.value.data };
}

/** Los conteos cuando la respuesta se guardó y el detalle no llegó: quien
 * responde es de la audiencia, así que su respuesta cuenta. */
export function recountWithResponse(
  previous: EventTally,
  response: RsvpResponse,
): EventTally {
  const countsAs = (answer: RsvpResponse | null, target: RsvpResponse) =>
    answer === target ? 1 : 0;
  return {
    goingCount:
      previous.goingCount -
      countsAs(previous.myResponse, "yes") +
      countsAs(response, "yes"),
    maybeCount:
      previous.maybeCount -
      countsAs(previous.myResponse, "maybe") +
      countsAs(response, "maybe"),
    myResponse: response,
  };
}

/** Guarda la respuesta y trae los conteos que quedaron. Si la respuesta se
 * guardó, ya no es un fallo aunque los conteos no lleguen: se recuentan a
 * partir de lo que había, para no enseñar una respuesta sin su voto. */
export async function saveRsvp(
  eventId: string,
  previous: EventTally,
  response: RsvpResponse,
): Promise<RsvpSave> {
  const saved = readApiPayload(
    await requestApi(eventPath(EVENT_RSVP_API_PATH, eventId), {
      method: "PUT",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify({ response }),
    }),
    savedRsvpResponseSchema,
  );
  if (saved.kind === "failed") {
    return saved;
  }
  const detail = readApiPayload(
    await requestApi(eventPath(EVENT_API_PATH, eventId)),
    detailResponseSchema,
  );
  return {
    kind: "saved",
    tally:
      detail.kind === "failed"
        ? recountWithResponse(previous, saved.value.data.response)
        : detail.value.data,
  };
}

/** Por qué no cargó la agenda, en el idioma de la pantalla. */
export function describeAgendaFailure(
  translate: Translator,
  { failure }: AgendaFailure,
): string {
  switch (failure) {
    case "network":
      return translate("auth.error.network");
    case "unauthenticated":
      return translate("calendar.error.signInRequired");
    default:
      return translate("calendar.error.unexpected");
  }
}

const RSVP_CLOSED_REASONS = {
  rsvp_event_started: "calendar.rsvp.error.started",
  rsvp_event_cancelled: "calendar.rsvp.error.cancelled",
} as const;

function isRsvpClosedReason(
  reason: string | null,
): reason is keyof typeof RSVP_CLOSED_REASONS {
  return reason !== null && Object.hasOwn(RSVP_CLOSED_REASONS, reason);
}

/** Por qué no se guardó una respuesta, en el idioma de la pantalla. El 422
 * trae en `reason` si el evento empezó o se canceló (#308). */
export function describeRsvpFailure(
  translate: Translator,
  { failure, reason }: AgendaFailure,
): string {
  if (failure === "business_rule" && isRsvpClosedReason(reason)) {
    return translate(RSVP_CLOSED_REASONS[reason]);
  }
  switch (failure) {
    case "network":
      return translate("calendar.rsvp.error.network");
    case "not_found":
      return translate("calendar.rsvp.error.notFound");
    case "unauthenticated":
      return translate("calendar.rsvp.error.signInRequired");
    default:
      return translate("calendar.rsvp.error.unexpected");
  }
}
