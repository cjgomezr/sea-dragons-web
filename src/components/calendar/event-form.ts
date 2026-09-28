import type { AudienceChoice } from "@/components/AudienceField";
import type {
  EventDraft,
  EventIssueCode,
  EventType,
} from "@/lib/events/event-creation";
import type { IsoWeekday } from "@/lib/events/event-occurrences";

/**
 * Lo que se escribe en el diálogo de evento (#313) y cómo se convierte en lo
 * que acepta la API (#307).
 *
 * La fecha de un evento suelto y el inicio de una serie son el mismo campo:
 * quien cambia de "Una vez" a "Semanal" a mitad no pierde la fecha que puso.
 * Aquí sólo se comprueba que lo obligatorio no esté en blanco, porque sin
 * eso la API respondería con un 400 que no dice qué campo falta. Todo lo
 * demás lo decide el servidor, y su motivo se pinta junto al campo.
 */

export type EventRepeat = EventDraft["repeat"];

export type EventForm = {
  readonly title: string;
  readonly eventType: EventType;
  readonly repeat: EventRepeat;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly weekdays: ReadonlySet<IsoWeekday>;
  readonly startTime: string;
  readonly location: string;
  readonly notes: string;
  readonly audience: AudienceChoice;
};

export const EMPTY_EVENT_FORM: EventForm = {
  title: "",
  eventType: "training",
  repeat: "none",
  startsOn: "",
  endsOn: "",
  weekdays: new Set(),
  startTime: "",
  location: "",
  notes: "",
  audience: { kind: "club", groupIds: new Set() },
};

export type EventFormField =
  | "title"
  | "startsOn"
  | "endsOn"
  | "weekdays"
  | "startTime"
  | "location"
  | "notes"
  | "audience";

/** Los motivos de la API que van junto a un campo. `event_started` y
 * `event_cancelled` hablan de un evento que ya existe (#314): crear no los
 * devuelve nunca. */
export type FieldIssueCode = Exclude<
  EventIssueCode,
  "event_started" | "event_cancelled"
>;

export type EventFormIssue = {
  readonly field: EventFormField;
  readonly code: FieldIssueCode | "required";
};

const ISSUE_FIELDS: Readonly<Record<FieldIssueCode, EventFormField>> = {
  event_title_invalid: "title",
  event_location_invalid: "location",
  event_notes_too_long: "notes",
  event_audience_empty: "audience",
  event_audience_foreign_group: "audience",
  // Pasado es la fecha con su hora, pero la hora casi siempre está bien.
  event_in_past: "startsOn",
  series_weekdays_empty: "weekdays",
  series_range_inverted: "endsOn",
  series_range_too_long: "endsOn",
  series_without_sessions: "weekdays",
};

export function isFieldIssueCode(reason: string): reason is FieldIssueCode {
  return Object.hasOwn(ISSUE_FIELDS, reason);
}

/** El campo junto al que se pinta un motivo de la API. */
export function issueFromApi(code: FieldIssueCode): EventFormIssue {
  return { field: ISSUE_FIELDS[code], code };
}

type RequiredField = Extract<
  EventFormField,
  "title" | "startsOn" | "endsOn" | "startTime" | "location"
>;

function requiredFields(form: EventForm): readonly RequiredField[] {
  const dates: readonly RequiredField[] =
    form.repeat === "none" ? ["startsOn"] : ["startsOn", "endsOn"];
  return ["title", ...dates, "startTime", "location"];
}

/** Los campos obligatorios que siguen en blanco, en el orden del diálogo. */
export function listMissingFields(form: EventForm): readonly EventFormIssue[] {
  return requiredFields(form)
    .filter((field) => form[field].trim() === "")
    .map((field) => ({ field, code: "required" }));
}

/** Lo que se manda: los días en orden de la semana, y las notas en blanco
 * como ninguna. */
export function toEventDraft(form: EventForm): EventDraft {
  const fields = {
    title: form.title,
    eventType: form.eventType,
    startTime: form.startTime,
    location: form.location,
    notes: form.notes.trim() === "" ? null : form.notes,
    audience:
      form.audience.kind === "club"
        ? { kind: "club" as const }
        : { kind: "groups" as const, groupIds: [...form.audience.groupIds] },
  };
  if (form.repeat === "none") {
    return { ...fields, repeat: "none", startsOn: form.startsOn };
  }
  return {
    ...fields,
    repeat: "weekly",
    weekdays: [...form.weekdays].sort((first, second) => first - second),
    startsOn: form.startsOn,
    endsOn: form.endsOn,
  };
}
