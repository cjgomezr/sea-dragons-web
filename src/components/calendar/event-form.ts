import type { AudienceChoice } from "@/components/AudienceField";
import type {
  AgendaEvent,
  NamedEventAudience,
} from "@/lib/events/event-agenda";
import type {
  EventAudience,
  EventDraft,
  EventIssueCode,
  EventType,
} from "@/lib/events/event-creation";
import type { EventEdit } from "@/lib/events/event-management";
import type { IsoWeekday } from "@/lib/events/event-occurrences";
import { type EventPlace, isSamePlace } from "@/lib/events/event-place";
import type { SeriesEdit } from "@/lib/events/series-management";
import type { EndScope } from "./event-end";

/**
 * Lo que se escribe en el diálogo de evento (#313) y cómo se convierte en lo
 * que acepta la API (#307).
 *
 * La fecha de un evento suelto y el inicio de una serie son el mismo campo:
 * quien cambia de "Una vez" a "Semanal" a mitad no pierde la fecha que puso.
 * Aquí sólo se comprueba que lo obligatorio no esté en blanco, porque sin
 * eso la API respondería con un 400 que no dice qué campo falta. Todo lo
 * demás lo decide el servidor, y su motivo se pinta junto al campo.
 *
 * Al editar (#316) el diálogo arranca con los datos del evento y manda sólo
 * lo que cambió: al editar una serie, un campo que no se tocó no debe pisar
 * el que una ocurrencia tenía editado a solas.
 */

/** Qué se escribe en el diálogo: un evento nuevo, uno que ya existe (o una
 * sola ocurrencia) o una serie de hoy en adelante, que no cambia de fechas. */
export type EventFormLayout = "create" | "event" | "series";

export type EventRepeat = EventDraft["repeat"];

/** La imagen al guardar (#650): la que había (ninguna, al crear) u otra, que
 * puede ser ninguna si se quitó. */
export type EventCoverChange =
  | { readonly kind: "keep" }
  | { readonly kind: "replace"; readonly coverUploadId: string | null };

export type EventForm = {
  readonly title: string;
  readonly eventType: EventType;
  readonly repeat: EventRepeat;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly weekdays: ReadonlySet<IsoWeekday>;
  readonly startTime: string;
  /** Vacía sólo al crear y en lo anterior a E24 (D5). */
  readonly endTime: string;
  /** "Termina otro día": sólo un evento suelto (D6). */
  readonly endsAnotherDay: boolean;
  /** La fecha de fin de un evento de varios días. `endsOn` es la de la
   * serie. */
  readonly endDate: string;
  /** Lo escrito en el buscador de lugares: el texto libre si no se elige
   * ninguno, y lo que vuelve al quitar el elegido (#652). */
  readonly location: string;
  /** El lugar elegido del buscador; nulo con texto libre. */
  readonly place: EventPlace | null;
  /** "Dónde exactamente": sólo va con un lugar elegido. */
  readonly placeDetail: string;
  readonly notes: string;
  readonly audience: AudienceChoice;
  readonly cover: EventCoverChange;
  /** Una ocurrencia que se edita a solas sigue siendo de su serie: no puede
   * terminar otro día (D6). */
  readonly belongsToSeries: boolean;
};

export const EMPTY_EVENT_FORM: EventForm = {
  title: "",
  eventType: "training",
  repeat: "none",
  startsOn: "",
  endsOn: "",
  weekdays: new Set(),
  startTime: "",
  endTime: "",
  endsAnotherDay: false,
  endDate: "",
  location: "",
  place: null,
  placeDetail: "",
  notes: "",
  audience: { kind: "club", groupIds: new Set() },
  cover: { kind: "keep" },
  belongsToSeries: false,
};

export type EventFormField =
  | "title"
  | "startsOn"
  | "endsOn"
  | "weekdays"
  | "startTime"
  | "endTime"
  | "endDate"
  | "location"
  | "placeDetail"
  | "notes"
  | "audience"
  | "cover";

/** Los motivos de la API que van junto a un campo. `event_started` y
 * `event_cancelled` hablan de un evento que ya existe (#314), y
 * `series_without_upcoming` y `occurrence_started` de una serie que ya existe
 * (#315, #653): crear no los devuelve nunca. */
export type FieldIssueCode = Exclude<
  EventIssueCode,
  | "event_started"
  | "event_cancelled"
  | "series_without_upcoming"
  | "occurrence_started"
>;

export type EventFormIssue = {
  readonly field: EventFormField;
  readonly code: FieldIssueCode | "required";
};

const ISSUE_FIELDS: Readonly<Record<FieldIssueCode, EventFormField>> = {
  event_title_invalid: "title",
  event_location_invalid: "location",
  // El lugar elegido sustituye al campo de texto: su motivo va donde estaba.
  event_place_invalid: "location",
  event_place_coordinates_invalid: "location",
  event_place_detail_invalid: "placeDetail",
  event_notes_too_long: "notes",
  event_audience_empty: "audience",
  event_audience_foreign_group: "audience",
  // Pasado es la fecha con su hora, pero la hora casi siempre está bien.
  event_in_past: "startsOn",
  series_weekdays_empty: "weekdays",
  series_range_inverted: "endsOn",
  series_range_too_long: "endsOn",
  series_without_sessions: "weekdays",
  // Una serie que cruza la medianoche se ve en la hora de fin: es lo que
  // hay que cambiar.
  end_time_required: "endTime",
  end_before_start: "endTime",
  multi_day_series: "endTime",
  event_cover_empty: "cover",
  event_cover_too_large: "cover",
  event_cover_type_unsupported: "cover",
  event_cover_upload_invalid: "cover",
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
  | "title"
  | "startsOn"
  | "endsOn"
  | "startTime"
  | "endTime"
  | "endDate"
  | "location"
>;

function requiredFields(form: EventForm): readonly RequiredField[] {
  const endDate: readonly RequiredField[] =
    form.repeat === "none" && form.endsAnotherDay ? ["endDate"] : [];
  const seriesEnd: readonly RequiredField[] =
    form.repeat === "none" ? [] : ["endsOn"];
  return [
    "title",
    "startsOn",
    "startTime",
    "endTime",
    ...endDate,
    ...seriesEnd,
    "location",
  ];
}

/** Si lo que se escribe es un evento suelto o sesiones de una serie, que
 * terminan el mismo día que empiezan. */
export function endScopeOf(layout: EventFormLayout, form: EventForm): EndScope {
  return layout === "series" || form.repeat === "weekly" || form.belongsToSeries
    ? "series"
    : "event";
}

/** Un lugar elegido es el lugar, aunque el buscador se quedara en blanco. */
function isBlank(form: EventForm, field: RequiredField): boolean {
  if (field === "location" && form.place !== null) {
    return false;
  }
  return form[field].trim() === "";
}

/** Los campos obligatorios que siguen en blanco, en el orden del diálogo. */
export function listMissingFields(form: EventForm): readonly EventFormIssue[] {
  return requiredFields(form)
    .filter((field) => isBlank(form, field))
    .map((field) => ({ field, code: "required" }));
}

/** Las notas en blanco son ninguna. */
function toNotes(notes: string): string | null {
  return notes.trim() === "" ? null : notes;
}

/** "Dónde exactamente" en blanco es ninguno. */
function toPlaceDetail(placeDetail: string): string | null {
  return placeDetail.trim() === "" ? null : placeDetail;
}

/** Dónde al crear: el lugar elegido con su detalle, o sólo el texto libre
 * (#645). Con lugar, `location` es su nombre, como lo guarda el servidor. */
function whereFields(form: EventForm): Pick<
  EventDraft,
  "location" | "place" | "placeDetail"
> {
  return form.place === null
    ? { location: form.location }
    : {
        location: form.place.name,
        place: form.place,
        placeDetail: toPlaceDetail(form.placeDetail),
      };
}

function toAudience(choice: AudienceChoice): EventAudience {
  return choice.kind === "club"
    ? { kind: "club" }
    : { kind: "groups", groupIds: [...choice.groupIds] };
}

/** La fecha de fin de un evento suelto como se guarda: ninguna si termina
 * el mismo día. */
function eventEndsOn(form: EventForm): string | null {
  return form.endsAnotherDay && form.endDate !== "" ? form.endDate : null;
}

function coverField(cover: EventCoverChange): {
  readonly coverUploadId?: string | null;
} {
  return cover.kind === "keep" ? {} : { coverUploadId: cover.coverUploadId };
}

/** Lo que se manda: los días en orden de la semana, y las notas en blanco
 * como ninguna. */
export function toEventDraft(form: EventForm): EventDraft {
  const fields = {
    title: form.title,
    eventType: form.eventType,
    startTime: form.startTime,
    endTime: form.endTime,
    ...whereFields(form),
    notes: toNotes(form.notes),
    audience: toAudience(form.audience),
    ...coverField(form.cover),
  };
  if (form.repeat === "none") {
    const endsOn = eventEndsOn(form);
    return {
      ...fields,
      repeat: "none",
      startsOn: form.startsOn,
      ...(endsOn === null ? {} : { endsOn }),
    };
  }
  return {
    ...fields,
    repeat: "weekly",
    weekdays: [...form.weekdays].sort((first, second) => first - second),
    startsOn: form.startsOn,
    endsOn: form.endsOn,
  };
}

/** El diálogo de editar arranca con lo que el evento tiene guardado. */
export function formFromEvent(
  event: AgendaEvent,
  details: {
    readonly notes: string | null;
    readonly audience: NamedEventAudience;
  },
): EventForm {
  return {
    ...EMPTY_EVENT_FORM,
    title: event.title,
    eventType: event.eventType,
    startsOn: event.startsOn,
    startTime: event.startTime,
    endTime: event.endTime ?? "",
    endsAnotherDay: event.endsOn !== null,
    endDate: event.endsOn ?? "",
    belongsToSeries: event.seriesId !== null,
    location: event.location,
    place: event.place,
    placeDetail: event.placeDetail ?? "",
    notes: details.notes ?? "",
    audience:
      details.audience.kind === "club"
        ? { kind: "club", groupIds: new Set() }
        : {
            kind: "groups",
            groupIds: new Set(details.audience.groups.map((group) => group.id)),
          },
  };
}

function isSameAudience(
  first: AudienceChoice,
  second: AudienceChoice,
): boolean {
  if (first.kind !== second.kind) {
    return false;
  }
  return (
    first.kind === "club" ||
    (first.groupIds.size === second.groupIds.size &&
      [...first.groupIds].every((groupId) => second.groupIds.has(groupId)))
  );
}

/** Lo que cambió de dónde (#645): el lugar nuevo, sólo su detalle, o el
 * texto libre. Volver al texto libre manda el texto aunque sea el mismo: es
 * lo que le dice al servidor que quite el lugar elegido. */
function listWhereChanges(
  initial: EventForm,
  form: EventForm,
): Pick<SeriesEdit, "location" | "place" | "placeDetail"> {
  if (form.place === null) {
    return initial.place === null && form.location === initial.location
      ? {}
      : { location: form.location };
  }
  const placeDetail = toPlaceDetail(form.placeDetail);
  return {
    ...(isSamePlace(form.place, initial.place) ? {} : { place: form.place }),
    ...(placeDetail === toPlaceDetail(initial.placeDetail)
      ? {}
      : { placeDetail }),
  };
}

/** Lo que cambió de lo que comparten un evento y una serie. */
export function listSeriesChanges(
  initial: EventForm,
  form: EventForm,
): SeriesEdit {
  const notes = toNotes(form.notes);
  return {
    ...(form.title === initial.title ? {} : { title: form.title }),
    ...(form.eventType === initial.eventType
      ? {}
      : { eventType: form.eventType }),
    ...(form.startTime === initial.startTime
      ? {}
      : { startTime: form.startTime }),
    ...(form.endTime === initial.endTime ? {} : { endTime: form.endTime }),
    ...listWhereChanges(initial, form),
    ...(notes === toNotes(initial.notes) ? {} : { notes }),
    ...(isSameAudience(form.audience, initial.audience)
      ? {}
      : { audience: toAudience(form.audience) }),
    ...coverField(form.cover),
  };
}

/** Lo que cambió de un evento suelto o una ocurrencia, que sí cambia de
 * fecha. */
export function listEventChanges(
  initial: EventForm,
  form: EventForm,
): EventEdit {
  return {
    ...listSeriesChanges(initial, form),
    ...(form.startsOn === initial.startsOn ? {} : { startsOn: form.startsOn }),
    ...(eventEndsOn(form) === eventEndsOn(initial)
      ? {}
      : { endsOn: eventEndsOn(form) }),
  };
}
