import { z } from "zod";
import {
  type ApiRequestFailure,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { EVENTS_MANAGE_API_PATH } from "@/lib/auth/routes";
import {
  EVENT_LOCATION_MAX_LENGTH,
  EVENT_NOTES_MAX_LENGTH,
  EVENT_TITLE_MAX_LENGTH,
  type EventDraft,
  SERIES_MAX_DAYS,
} from "@/lib/events/event-creation";
import type { Translator } from "@/lib/i18n/translator";
import {
  type EventFormIssue,
  type FieldIssueCode,
  isFieldIssueCode,
} from "./event-form";

/**
 * Lo que el diálogo de evento (#313) le pide a la API v1 (#307) y cómo reduce
 * la respuesta a algo que pintar. Nada habla con la base: la aplicación
 * nativa de Release 2 va a usar este mismo camino (CON-002). De un error se
 * guarda el código, y la frase se arma al pintar, en el idioma de la
 * pantalla (E17).
 */

// Del evento creado sólo hace falta saber si fue una serie y de cuántas
// sesiones: la agenda se vuelve a pedir para pintarlo.
const createdResponseSchema = z.object({
  data: z.discriminatedUnion("repeat", [
    z.object({ repeat: z.literal("none") }),
    z.object({
      repeat: z.literal("weekly"),
      occurrences: z.array(z.object({ id: z.uuid() })),
    }),
  ]),
});

export type CreatedSummary =
  | { readonly repeat: "none" }
  | { readonly repeat: "weekly"; readonly sessionCount: number };

export type EventCreation =
  | { readonly kind: "created"; readonly summary: CreatedSummary }
  | ApiRequestFailure;

export async function createEvent(draft: EventDraft): Promise<EventCreation> {
  const read = readApiPayload(
    await requestApi(EVENTS_MANAGE_API_PATH, {
      method: "POST",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify(draft),
    }),
    createdResponseSchema,
  );
  if (read.kind === "failed") {
    return read;
  }
  const created = read.value.data;
  return {
    kind: "created",
    summary:
      created.repeat === "none"
        ? { repeat: "none" }
        : { repeat: "weekly", sessionCount: created.occurrences.length },
  };
}

/** El motivo de un 422 que el diálogo sabe poner junto a un campo, o null. */
export function readEventIssue({
  failure,
  reason,
}: ApiRequestFailure): FieldIssueCode | null {
  if (failure !== "business_rule" || reason === null) {
    return null;
  }
  return isFieldIssueCode(reason) ? reason : null;
}

export function describeEventIssue(
  translate: Translator,
  { code }: EventFormIssue,
): string {
  switch (code) {
    case "required":
      return translate("calendar.form.issue.required");
    case "event_title_invalid":
      return translate("calendar.form.issue.event_title_invalid", {
        max: EVENT_TITLE_MAX_LENGTH,
      });
    case "event_location_invalid":
      return translate("calendar.form.issue.event_location_invalid", {
        max: EVENT_LOCATION_MAX_LENGTH,
      });
    case "event_notes_too_long":
      return translate("calendar.form.issue.event_notes_too_long", {
        max: EVENT_NOTES_MAX_LENGTH,
      });
    case "series_range_too_long":
      return translate("calendar.form.issue.series_range_too_long", {
        max: SERIES_MAX_DAYS,
      });
    case "event_audience_empty":
    case "event_audience_foreign_group":
    case "event_in_past":
    case "series_weekdays_empty":
    case "series_range_inverted":
    case "series_without_sessions":
      return translate(`calendar.form.issue.${code}`);
  }
}

/** Lo que no va junto a ningún campo, en el idioma de la pantalla. */
export function describeCreateFailure(
  translate: Translator,
  { failure }: ApiRequestFailure,
): string {
  switch (failure) {
    case "network":
      return translate("calendar.form.error.network");
    case "unauthenticated":
      return translate("calendar.form.error.signInRequired");
    case "forbidden":
      return translate("calendar.form.error.forbidden");
    default:
      return translate("calendar.form.error.unexpected");
  }
}

/** El aviso de la agenda tras crear: la API ya avisó a la audiencia (#310). */
export function describeCreated(
  translate: Translator,
  summary: CreatedSummary,
): string {
  return summary.repeat === "none"
    ? translate("calendar.create.created")
    : translate("calendar.create.createdSeries", {
        count: summary.sessionCount,
      });
}
