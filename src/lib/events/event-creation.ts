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
import type { EventCoversGateway } from "./event-covers";
import {
  type EventPlace,
  LATITUDE_LIMIT,
  LONGITUDE_LIMIT,
  PLACE_ADDRESS_MAX_LENGTH,
  PLACE_DETAIL_MAX_LENGTH,
  PLACE_NAME_MAX_LENGTH,
  type PlaceCoordinates,
  type PlaceDraft,
} from "./event-place";
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

export function isEventType(value: string): value is EventType {
  return EVENT_TYPES.some((type) => type === value);
}

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
  /** `HH:MM` de Melbourne. Nula sólo en lo creado antes de E24 (D5). */
  readonly endTime: string | null;
  /** El texto que se enseña: el nombre del lugar elegido o el texto
   * libre. */
  readonly location: string;
  /** Nulo con texto libre y en lo anterior a E24 (#645). */
  readonly place: EventPlace | null;
  /** "Dónde exactamente": la piscina, la sala. */
  readonly placeDetail: string | null;
  readonly notes: string | null;
  readonly audience: EventAudience;
};

export type SeriesRange = {
  readonly weekdays: readonly IsoWeekday[];
  readonly startsOn: string;
  readonly endsOn: string;
};

/** Lo que manda quien crea, tal como llega. La hora de fin puede faltar:
 * se rechaza con 422 y no con 400, para que la pantalla lo traduzca. Sólo un
 * evento suelto tiene fecha de fin (D6); en una serie, `endsOn` es la de la
 * serie. */
export type EventDraft = Omit<
  EventFields,
  "endTime" | "place" | "placeDetail"
> & {
  readonly endTime?: string | null;
  readonly place?: PlaceDraft | null;
  readonly placeDetail?: string | null;
  /** Una subida de `POST /api/v1/events/manage/uploads` (#644). */
  readonly coverUploadId?: string | null;
} & (
    | {
        readonly repeat: "none";
        readonly startsOn: string;
        readonly endsOn?: string | null;
      }
    | ({ readonly repeat: "weekly" } & SeriesRange)
  );

/** Lo nuevo siempre dice cuándo termina (D5). */
export type NewEventFields = EventFields & { readonly endTime: string };

/** Lo que se guarda de una vez: la serie, si la hay, y una fila por fecha.
 * `endsOn` es la fecha de fin de un evento suelto de varios días, y nula en
 * uno de un día y en las sesiones de una serie. */
export type NewEventSchedule = {
  readonly clubId: string;
  readonly authorId: string;
  readonly fields: NewEventFields;
  readonly endsOn: string | null;
  /** La imagen, que la base copia a la serie y a cada sesión (#644). */
  readonly coverUploadId: string | null;
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
  readonly endsOn: string | null;
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
  readonly eventCovers: Pick<EventCoversGateway, "findCover">;
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
  "occurrence_started",
  "series_without_upcoming",
  "end_time_required",
  "end_before_start",
  "multi_day_series",
  "event_place_invalid",
  "event_place_coordinates_invalid",
  "event_place_detail_invalid",
  "event_cover_empty",
  "event_cover_too_large",
  "event_cover_type_unsupported",
  "event_cover_upload_invalid",
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
  occurrence_started:
    "La sesión ya empezó: la serie sólo se puede partir desde una sesión futura.",
  series_without_upcoming:
    "La serie no tiene sesiones futuras sin cancelar: no queda nada que cambiar.",
  end_time_required: "Indica la hora de fin del evento.",
  end_before_start: "El fin del evento tiene que ir después de su inicio.",
  multi_day_series:
    "Las sesiones de una serie son de un día: sólo un evento suelto dura varios días.",
  event_place_invalid: `El nombre del lugar tiene que tener entre 1 y ${PLACE_NAME_MAX_LENGTH} caracteres, y su dirección como mucho ${PLACE_ADDRESS_MAX_LENGTH}, sin caracteres de control.`,
  event_place_coordinates_invalid: `Las coordenadas del lugar van las dos o ninguna, con la latitud entre -${LATITUDE_LIMIT} y ${LATITUDE_LIMIT} y la longitud entre -${LONGITUDE_LIMIT} y ${LONGITUDE_LIMIT}.`,
  event_place_detail_invalid: `"Dónde exactamente" puede tener como mucho ${PLACE_DETAIL_MAX_LENGTH} caracteres, sin caracteres de control.`,
  event_cover_empty: "La imagen está vacía.",
  event_cover_too_large: "La imagen puede pesar como mucho 10 MB.",
  event_cover_type_unsupported:
    "La imagen tiene que ser un JPEG, un PNG o un WebP que se pueda abrir.",
  event_cover_upload_invalid:
    "La imagen no está entre las que subieron quienes organizan eventos en tu club.",
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

/** Una línea opcional: en blanco es ninguna. */
function normalizeOptionalLine(
  raw: string | null | undefined,
  maxLength: number,
  issue: EventIssueCode,
): string | null {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return null;
  }
  return normalizeLine(raw, maxLength, issue);
}

function isWithin(value: number, limit: number): boolean {
  return value >= -limit && value <= limit;
}

function normalizeCoordinates(place: PlaceDraft): PlaceCoordinates {
  const lat = place.lat ?? null;
  const lng = place.lng ?? null;
  if (lat === null && lng === null) {
    return { lat, lng };
  }
  if (
    lat === null ||
    lng === null ||
    !isWithin(lat, LATITUDE_LIMIT) ||
    !isWithin(lng, LONGITUDE_LIMIT)
  ) {
    throw new EventValidationError("event_place_coordinates_invalid");
  }
  return { lat, lng };
}

/** Un lugar elegido, recortado; sin dirección o sin coordenadas sigue
 * valiendo (un lugar del club que se guardó así). También lo usa editar. */
export function normalizePlace(place: PlaceDraft): EventPlace {
  return {
    name: normalizeLine(
      place.name,
      PLACE_NAME_MAX_LENGTH,
      "event_place_invalid",
    ),
    address: normalizeOptionalLine(
      place.address,
      PLACE_ADDRESS_MAX_LENGTH,
      "event_place_invalid",
    ),
    ...normalizeCoordinates(place),
  };
}

export function normalizePlaceDetail(
  raw: string | null | undefined,
): string | null {
  return normalizeOptionalLine(
    raw,
    PLACE_DETAIL_MAX_LENGTH,
    "event_place_detail_invalid",
  );
}

/** Dónde es un evento: con un lugar elegido, `location` es su nombre; sin
 * él, el texto libre. */
function resolveWhere(
  location: string,
  draft: PlaceDraft | null | undefined,
): Pick<EventFields, "location" | "place"> {
  if (draft === null || draft === undefined) {
    return { location: normalizeLocation(location), place: null };
  }
  const place = normalizePlace(draft);
  return { location: place.name, place };
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

/** Quien enlaza una imagen: su club y su id. */
export type CoverOrganizer = {
  readonly clubId: string;
  readonly userId: string;
};

/** Si quien subió la imagen organiza eventos en el club: quien la enlaza, u
 * otra persona que todavía tiene el rol. Una ficha borrada no cuenta. */
async function isOrganizerUpload(
  gateways: Pick<EventGateways, "members">,
  organizer: CoverOrganizer,
  uploadedBy: string | null,
): Promise<boolean> {
  if (uploadedBy === null) {
    return false;
  }
  if (uploadedBy === organizer.userId) {
    return true;
  }
  const uploader = await gateways.members.findRoleRequestMember(uploadedBy);
  return (
    uploader !== null &&
    uploader.clubId === organizer.clubId &&
    hasCapability(uploader.role, "createEvents")
  );
}

/** La imagen que se enlaza (#644), o por qué no vale. Una subida se comparte
 * entre la serie y sus sesiones, así que no hace falta que esté libre; sí que
 * sea del club y de alguien que organiza. Sin el campo no cambia nada
 * (`undefined`), y a `null` se quita. También lo usan editar un evento y una
 * serie. */
export async function resolveCoverUpload(
  gateways: Pick<EventGateways, "members" | "eventCovers">,
  organizer: CoverOrganizer,
  coverUploadId: string | null | undefined,
): Promise<string | null | undefined> {
  if (coverUploadId === null || coverUploadId === undefined) {
    return coverUploadId;
  }
  const cover = await gateways.eventCovers.findCover(coverUploadId);
  if (
    cover === null ||
    cover.clubId !== organizer.clubId ||
    !(await isOrganizerUpload(gateways, organizer, cover.uploadedBy))
  ) {
    throw new EventValidationError("event_cover_upload_invalid");
  }
  return cover.id;
}

/** Cuándo termina un evento, como se guarda. */
export type EventEnd = {
  readonly endTime: string;
  /** Nula si termina el mismo día que empieza. */
  readonly endsOn: string | null;
};

/** Lo que hay que saber de un evento para decidir si su fin vale. */
export type EventEndCandidate = {
  readonly startsOn: string;
  readonly startTime: string;
  readonly endTime: string | null | undefined;
  readonly endsOn: string | null | undefined;
  readonly isSeriesSession: boolean;
};

function isMultiDay(candidate: EventEndCandidate): boolean {
  return (
    candidate.endsOn !== null &&
    candidate.endsOn !== undefined &&
    candidate.endsOn !== candidate.startsOn
  );
}

/** El fin de un evento, o por qué no vale. Una fecha de fin igual a la de
 * inicio es un evento de un día y se guarda como ninguna. Las fechas y las
 * horas se comparan como texto: `YYYY-MM-DD` y `HH:MM` ordenan igual que lo
 * que nombran. También lo usan editar un evento y editar una serie. */
export function resolveEventEnd(candidate: EventEndCandidate): EventEnd {
  const { endTime, endsOn } = candidate;
  if (endTime === null || endTime === undefined) {
    throw new EventValidationError("end_time_required");
  }
  if (!isMultiDay(candidate)) {
    if (endTime <= candidate.startTime) {
      throw new EventValidationError("end_before_start");
    }
    return { endTime, endsOn: null };
  }
  if (candidate.isSeriesSession) {
    throw new EventValidationError("multi_day_series");
  }
  if (endsOn === null || endsOn === undefined || endsOn < candidate.startsOn) {
    throw new EventValidationError("end_before_start");
  }
  return { endTime, endsOn };
}

function resolveDraftEnd(draft: EventDraft): EventEnd {
  return resolveEventEnd({
    startsOn: draft.startsOn,
    startTime: draft.startTime,
    endTime: draft.endTime,
    endsOn: draft.repeat === "none" ? draft.endsOn : null,
    isSeriesSession: draft.repeat === "weekly",
  });
}

async function normalizeFields(
  gateways: Pick<EventGateways, "events">,
  clubId: string,
  draft: EventDraft & { readonly endTime: string },
): Promise<NewEventFields> {
  return {
    title: normalizeTitle(draft.title),
    eventType: draft.eventType,
    startTime: draft.startTime,
    endTime: draft.endTime,
    ...resolveWhere(draft.location, draft.place),
    placeDetail: normalizePlaceDetail(draft.placeDetail),
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
    return {
      repeat: "none",
      event: {
        ...schedule.fields,
        ...occurrences[0],
        endsOn: schedule.endsOn,
      },
    };
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
  const end = resolveDraftEnd(request.draft);
  const coverUploadId = await resolveCoverUpload(
    gateways,
    { clubId: caller.clubId, userId: request.callerId },
    request.draft.coverUploadId,
  );
  const schedule: NewEventSchedule = {
    clubId: caller.clubId,
    authorId: request.callerId,
    fields: await normalizeFields(gateways, caller.clubId, {
      ...request.draft,
      endTime: end.endTime,
    }),
    endsOn: end.endsOn,
    coverUploadId: coverUploadId ?? null,
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
