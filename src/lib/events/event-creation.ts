import type { ClubAudience } from "@/lib/notifications/audience-members";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type {
  RoleRequestGateways,
  RoleRequestMember,
} from "@/lib/auth/role-request";
import { hasCapability } from "@/lib/auth/roles";
import { clubMoment } from "@/lib/time/club-calendar";
import {
  type EventNoticeGateways,
  announceEvents,
} from "./event-creation-notice";
import {
  type IsoWeekday,
  countRangeDays,
  generateWeeklyOccurrences,
  isStillAhead,
} from "./event-occurrences";

/**
 * Crear un evento suelto o una serie semanal (#307, RF-2 y RF-3 del PRD de
 * E7), contado sin Supabase delante.
 *
 * El club sale siempre de la fila de quien llama, nunca de un parámetro
 * (NFR-009). Las ocurrencias de una serie se calculan aquí, al crearla, y se
 * guardan todas de una vez con la serie: el plan maestro dejó `pg_cron` para
 * E16b.
 */

/** Los mismos que acepta el `check` de `events.event_type` en
 * `0034_events.sql` (AC-051). */
export const EVENT_TYPES = [
  "training",
  "competition",
  "meeting",
  "social",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Los mismos topes que los `check` de `0034_events.sql`. La pantalla los
 * usará para su formulario. */
export const EVENT_TITLE_MAX_LENGTH = 80;
export const EVENT_LOCATION_MAX_LENGTH = 120;
export const EVENT_NOTES_MAX_LENGTH = 2000;

/** Un año de lunes a domingo, el máximo de ocurrencias que admite el PRD
 * (sección 6). Se cuenta en días y no en años de calendario, para que un año
 * con 29 de febrero no dé 367. */
export const SERIES_MAX_DAYS = 366;

const CONTROL_CHARACTER = /\p{Cc}/u;

/** "Todo el club" y "estos grupos" son dos casos, como en las noticias: una
 * audiencia de cero grupos es un valor que se nombra y se rechaza al crear. */
export type EventAudience = ClubAudience;

/** Lo que una serie comparte con cada una de sus ocurrencias. */
export type EventFields = {
  readonly title: string;
  readonly eventType: EventType;
  /** `HH:MM` de Melbourne. */
  readonly startTime: string;
  readonly location: string;
  readonly notes: string | null;
  readonly audience: EventAudience;
};

export type SeriesRange = {
  readonly weekdays: readonly IsoWeekday[];
  readonly startsOn: string;
  readonly endsOn: string;
};

/** Lo que manda quien crea, tal como llega. */
export type EventDraft = EventFields &
  (
    | { readonly repeat: "none"; readonly startsOn: string }
    | ({ readonly repeat: "weekly" } & SeriesRange)
  );

/** Lo que se guarda de una vez: la serie, si la hay, y una fila por fecha. */
export type NewEventSchedule = {
  readonly clubId: string;
  readonly authorId: string;
  readonly fields: EventFields;
  readonly occurrenceDates: readonly string[];
  readonly series: SeriesRange | null;
};

/** Los ids de las ocurrencias van en el orden de `occurrenceDates`. */
export type SavedEventSchedule = {
  readonly seriesId: string | null;
  readonly eventIds: readonly string[];
};

export type CreatedEvent = EventFields & {
  readonly id: string;
  readonly startsOn: string;
};

/** Una serie no repite sus campos en cada ocurrencia: una temporada son
 * cientos de filas iguales salvo por la fecha. */
export type CreatedEvents =
  | { readonly repeat: "none"; readonly event: CreatedEvent }
  | {
      readonly repeat: "weekly";
      readonly series: EventFields & SeriesRange & { readonly id: string };
      readonly occurrences: readonly {
        readonly id: string;
        readonly startsOn: string;
      }[];
    };

export type EventsGateway = {
  /** Cuáles de estos grupos son del club. */
  findClubGroupIds(query: {
    readonly clubId: string;
    readonly groupIds: readonly string[];
  }): Promise<ReadonlySet<string>>;
  /** Todo o nada: si una fila falla, no queda ninguna. */
  insertSchedule(schedule: NewEventSchedule): Promise<SavedEventSchedule>;
};

/** Crear es guardar y después avisar a la audiencia (#310). */
export type EventGateways = EventNoticeGateways & {
  readonly members: RoleRequestGateways["members"];
  readonly events: EventsGateway;
};

export const EVENT_ISSUE_CODES = [
  "event_title_invalid",
  "event_location_invalid",
  "event_notes_too_long",
  "event_audience_empty",
  "event_audience_foreign_group",
  "event_in_past",
  "series_weekdays_empty",
  "series_range_inverted",
  "series_range_too_long",
  "series_without_sessions",
  "event_started",
  "event_cancelled",
  "series_without_upcoming",
] as const;

export type EventIssueCode = (typeof EVENT_ISSUE_CODES)[number];

const ISSUE_MESSAGES: Readonly<Record<EventIssueCode, string>> = {
  event_title_invalid: `El título tiene que tener entre 1 y ${EVENT_TITLE_MAX_LENGTH} caracteres, sin caracteres de control.`,
  event_location_invalid: `El lugar tiene que tener entre 1 y ${EVENT_LOCATION_MAX_LENGTH} caracteres, sin caracteres de control.`,
  event_notes_too_long: `Las notas pueden tener como mucho ${EVENT_NOTES_MAX_LENGTH} caracteres.`,
  event_audience_empty: "La audiencia es todo el club o al menos un grupo.",
  event_audience_foreign_group:
    "Uno de los grupos de la audiencia no existe en tu club.",
  event_in_past: "La fecha y la hora del evento ya pasaron.",
  series_weekdays_empty: "Elige al menos un día de la semana.",
  series_range_inverted: "La fecha de fin va antes de la de inicio.",
  series_range_too_long: `Una serie puede durar como mucho ${SERIES_MAX_DAYS} días.`,
  series_without_sessions:
    "Con esos días y esas fechas no saldría ninguna sesión.",
  event_started: "El evento ya empezó: ya no se puede cambiar.",
  event_cancelled: "El evento está cancelado: ya no se puede cambiar.",
  series_without_upcoming:
    "La serie no tiene sesiones futuras sin cancelar: no queda nada que cambiar.",
};

export class EventValidationError extends Error {
  readonly code: EventIssueCode;

  constructor(code: EventIssueCode) {
    super(ISSUE_MESSAGES[code]);
    this.name = "EventValidationError";
    this.code = code;
  }
}

export class EventsForbiddenError extends Error {
  constructor() {
    super("Tu rol no te permite organizar eventos.");
    this.name = "EventsForbiddenError";
  }
}

/** Quien llama, si puede crear, editar y cancelar eventos. La frontera ya
 * niega el camino a quien no puede; esto es el cerrojo del dominio, para que
 * no dependa de que nadie olvide la línea de `RESTRICTED_ROUTES`. */
export async function findEventOrganizer(
  gateways: Pick<EventGateways, "members">,
  callerId: string,
): Promise<RoleRequestMember> {
  const caller = await gateways.members.findRoleRequestMember(callerId);
  if (caller === null) {
    throw new MemberNotFoundError(callerId);
  }
  if (!hasCapability(caller.role, "createEvents")) {
    throw new EventsForbiddenError();
  }
  return caller;
}

/** Recortado y contado en caracteres como `char_length`, igual que el título
 * de una noticia. */
function normalizeLine(
  raw: string,
  maxLength: number,
  issue: EventIssueCode,
): string {
  const value = raw.trim();
  const length = [...value].length;
  if (length === 0 || length > maxLength || CONTROL_CHARACTER.test(value)) {
    throw new EventValidationError(issue);
  }
  return value;
}

export function normalizeTitle(raw: string): string {
  return normalizeLine(raw, EVENT_TITLE_MAX_LENGTH, "event_title_invalid");
}

export function normalizeLocation(raw: string): string {
  return normalizeLine(
    raw,
    EVENT_LOCATION_MAX_LENGTH,
    "event_location_invalid",
  );
}

/** Las notas son texto libre con saltos de línea; unas en blanco no dicen
 * nada y se guardan como ninguna. */
export function normalizeNotes(raw: string | null): string | null {
  const notes = raw?.trim() ?? "";
  if (notes.length === 0) {
    return null;
  }
  if ([...notes].length > EVENT_NOTES_MAX_LENGTH) {
    throw new EventValidationError("event_notes_too_long");
  }
  return notes;
}

/** Una audiencia de grupos vacía se rechaza aquí y no en la base: borrar un
 * grupo puede dejar un evento así, y la base no debe impedirlo. */
export async function resolveAudience(
  gateways: {
    readonly events: Pick<EventsGateway, "findClubGroupIds">;
  },
  clubId: string,
  audience: EventAudience,
): Promise<EventAudience> {
  if (audience.kind === "club") {
    return audience;
  }
  const groupIds = [...new Set(audience.groupIds)];
  if (groupIds.length === 0) {
    throw new EventValidationError("event_audience_empty");
  }
  const clubGroupIds = await gateways.events.findClubGroupIds({
    clubId,
    groupIds,
  });
  if (groupIds.some((id) => !clubGroupIds.has(id))) {
    throw new EventValidationError("event_audience_foreign_group");
  }
  return { kind: "groups", groupIds };
}

async function normalizeFields(
  gateways: Pick<EventGateways, "events">,
  clubId: string,
  draft: EventDraft,
): Promise<EventFields> {
  return {
    title: normalizeTitle(draft.title),
    eventType: draft.eventType,
    startTime: draft.startTime,
    location: normalizeLocation(draft.location),
    notes: normalizeNotes(draft.notes),
    audience: await resolveAudience(gateways, clubId, draft.audience),
  };
}

/** Los días ordenados y sin repetir, y un rango que no vuelve atrás ni pasa
 * de un año. */
function normalizeSeriesRange(range: SeriesRange): SeriesRange {
  const weekdays = [...new Set(range.weekdays)].sort(
    (first, second) => first - second,
  );
  if (weekdays.length === 0) {
    throw new EventValidationError("series_weekdays_empty");
  }
  const dayCount = countRangeDays(range.startsOn, range.endsOn);
  if (dayCount < 1) {
    throw new EventValidationError("series_range_inverted");
  }
  if (dayCount > SERIES_MAX_DAYS) {
    throw new EventValidationError("series_range_too_long");
  }
  return { weekdays, startsOn: range.startsOn, endsOn: range.endsOn };
}

type PlannedDates = {
  readonly occurrenceDates: readonly string[];
  readonly series: SeriesRange | null;
};

/** Qué fechas se guardan, o por qué ninguna vale. */
function planDates(draft: EventDraft, now: Date): PlannedDates {
  const moment = clubMoment(now);
  if (draft.repeat === "none") {
    if (
      !isStillAhead({ date: draft.startsOn, time: draft.startTime }, moment)
    ) {
      throw new EventValidationError("event_in_past");
    }
    return { occurrenceDates: [draft.startsOn], series: null };
  }
  const series = normalizeSeriesRange(draft);
  const occurrenceDates = generateWeeklyOccurrences(
    { ...series, startTime: draft.startTime },
    moment,
  );
  if (occurrenceDates.length === 0) {
    throw new EventValidationError("series_without_sessions");
  }
  return { occurrenceDates, series };
}

type SavedOccurrence = { readonly id: string; readonly startsOn: string };

/** Cada fecha con el id que le dio la base, que vuelven en el mismo orden. */
function pairOccurrenceIds(
  dates: readonly string[],
  saved: SavedEventSchedule,
): readonly [SavedOccurrence, ...SavedOccurrence[]] {
  const [first, ...rest] = dates.map((startsOn, index) => {
    const id = saved.eventIds[index];
    if (id === undefined) {
      throw new Error(`La ocurrencia del ${startsOn} no volvió con su id.`);
    }
    return { id, startsOn };
  });
  if (first === undefined) {
    throw new Error("Se guardó un evento sin ninguna fecha.");
  }
  return [first, ...rest];
}

function toCreatedEvents(
  schedule: NewEventSchedule,
  saved: SavedEventSchedule,
): CreatedEvents {
  const occurrences = pairOccurrenceIds(schedule.occurrenceDates, saved);
  if (schedule.series === null) {
    return { repeat: "none", event: { ...schedule.fields, ...occurrences[0] } };
  }
  if (saved.seriesId === null) {
    throw new Error("La serie se guardó sin volver con su id.");
  }
  return {
    repeat: "weekly",
    series: { ...schedule.fields, ...schedule.series, id: saved.seriesId },
    occurrences,
  };
}

/** Crea el evento o la serie con todas sus ocurrencias, o dice por qué no.
 * Nada se escribe hasta que todo se ha validado, y la audiencia se entera
 * sólo de lo que quedó guardado. */
export async function createEvents(
  gateways: EventGateways,
  request: {
    readonly callerId: string;
    readonly draft: EventDraft;
    readonly now: Date;
  },
): Promise<CreatedEvents> {
  const caller = await findEventOrganizer(gateways, request.callerId);
  const planned = planDates(request.draft, request.now);
  const schedule: NewEventSchedule = {
    clubId: caller.clubId,
    authorId: request.callerId,
    fields: await normalizeFields(gateways, caller.clubId, request.draft),
    ...planned,
  };
  const saved = await gateways.events.insertSchedule(schedule);
  const created = toCreatedEvents(schedule, saved);
  await announceEvents(gateways, {
    clubId: caller.clubId,
    authorId: request.callerId,
    created,
  });
  return created;
}
