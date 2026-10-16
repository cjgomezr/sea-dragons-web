import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { clubMoment } from "@/lib/time/club-calendar";
import {
  type CoverOrganizer,
  type EventFields,
  type EventGateways,
  type EventsGateway,
  EventValidationError,
  findEventOrganizer,
  normalizeLocation,
  normalizeNotes,
  normalizePlace,
  normalizePlaceDetail,
  normalizeTitle,
  resolveAudience,
  resolveCoverUpload,
  resolveEventEnd,
} from "./event-creation";
import {
  announceEventCancellation,
  announceEventChange,
} from "./event-change-notice";
import type { EventNoticeGateways } from "./event-creation-notice";
import { isStillAhead } from "./event-occurrences";
import type { PlaceDraft } from "./event-place";
import { EventNotFoundError } from "./event-rsvp";

/**
 * Editar y cancelar un evento suelto o una sola ocurrencia de una serie
 * (#314, RF-11 del PRD de E7), contado sin Supabase delante.
 *
 * Una ocurrencia guarda su propia copia de los campos de la serie
 * (`0034_events.sql`), así que editarla no toca a sus hermanas ni a la
 * serie. Cancelar marca y no borra: las respuestas se conservan para el
 * historial de E8, y la regla de #308 ya no deja responder a un cancelado.
 *
 * El club sale de la fila de quien llama (NFR-009): un evento de otro club
 * no se encuentra, igual que uno que no existe.
 */

type ManagedEventState =
  | { readonly status: "scheduled" }
  | { readonly status: "cancelled"; readonly cancelledAt: string };

/** Un evento como lo ve quien lo organiza. */
export type ManagedEvent = EventFields & {
  readonly id: string;
  /** Nula en un evento suelto. */
  readonly seriesId: string | null;
  readonly startsOn: string;
  /** Nula si termina el mismo día, y siempre en una sesión de una serie. */
  readonly endsOn: string | null;
} & ManagedEventState;

/** Lo que se puede cambiar de un evento; lo que no viene se queda igual.
 * `endsOn` a `null` lo vuelve de un día, y `coverUploadId` a `null` le quita
 * la imagen (#644). */
export type EventEdit = Partial<
  EventFields & {
    readonly startsOn: string;
    readonly endsOn: string | null;
    readonly coverUploadId: string | null;
  }
>;

/** Lo que cambia tal como llega: el lugar todavía sin validar. Un lugar
 * elegido pone su nombre en `location`. A `null`, o con un `location` que
 * llega sin `place`, el evento vuelve al texto libre y pierde también
 * "dónde exactamente", salvo que llegue otro: el formulario anterior a #646
 * sólo manda el texto. */
export type EventEditDraft = Omit<EventEdit, "place"> & {
  readonly place?: PlaceDraft | null;
};

/** `closed` si el evento se canceló o empezó entre leerlo y escribirlo. */
export type ManagedEventWrite = "saved" | "closed";

export type ManagedEventsGateway = {
  /** El evento, si es de ese club. */
  findEvent(query: {
    readonly clubId: string;
    readonly eventId: string;
  }): Promise<ManagedEvent | null>;
  /** Escribe sólo lo que traen los cambios, todo o nada. Una audiencia nueva
   * sustituye entera a la anterior. */
  updateEvent(update: {
    readonly clubId: string;
    readonly eventId: string;
    readonly changes: EventEdit;
  }): Promise<ManagedEventWrite>;
  cancelEvent(cancellation: {
    readonly clubId: string;
    readonly eventId: string;
    readonly cancelledAt: Date;
  }): Promise<ManagedEventWrite>;
};

export type EventManagementGateways = EventNoticeGateways & {
  readonly members: RoleRequestGateways["members"];
  readonly events: Pick<EventsGateway, "findClubGroupIds">;
  readonly eventCovers: EventGateways["eventCovers"];
  readonly managedEvents: ManagedEventsGateway;
};

type EventTarget = {
  readonly clubId: string;
  readonly eventId: string;
  readonly now: Date;
};

function hasStarted(event: ManagedEvent, now: Date): boolean {
  return !isStillAhead(
    { date: event.startsOn, time: event.startTime },
    clubMoment(now),
  );
}

/** El evento, si todavía se puede cambiar, o por qué no. */
async function findOpenEvent(
  gateways: Pick<EventManagementGateways, "managedEvents">,
  target: EventTarget,
): Promise<ManagedEvent> {
  const event = await gateways.managedEvents.findEvent(target);
  if (event === null) {
    throw new EventNotFoundError();
  }
  if (event.status === "cancelled") {
    throw new EventValidationError("event_cancelled");
  }
  if (hasStarted(event, target.now)) {
    throw new EventValidationError("event_started");
  }
  return event;
}

/** Lee otra vez el evento después de escribir. Si la escritura llegó tarde,
 * la nueva lectura dice por qué. */
async function readBackEvent(
  gateways: Pick<EventManagementGateways, "managedEvents">,
  target: EventTarget,
  write: ManagedEventWrite,
): Promise<ManagedEvent> {
  if (write === "closed") {
    await findOpenEvent(gateways, target);
    throw new Error(
      `El evento ${target.eventId} rechazó la escritura sin estar cerrado.`,
    );
  }
  const event = await gateways.managedEvents.findEvent(target);
  if (event === null) {
    throw new EventNotFoundError();
  }
  return event;
}

/** El lugar, el texto que se enseña y el detalle, si cambian. Con un lugar
 * elegido, el texto es su nombre aunque llegue otro; un texto libre sin lugar
 * quita el elegido, para que `location` y `place` no se contradigan. */
function normalizeWhere({
  place,
  location,
}: Pick<EventEditDraft, "location" | "place">): Pick<
  EventEdit,
  "location" | "place" | "placeDetail"
> {
  if (place !== null && place !== undefined) {
    const normalized = normalizePlace(place);
    return { location: normalized.name, place: normalized };
  }
  if (location === undefined) {
    return place === null ? { place: null, placeDetail: null } : {};
  }
  return {
    location: normalizeLocation(location),
    place: null,
    placeDetail: null,
  };
}

/** La imagen, si cambia: una que vale, o `null` para quitarla. */
async function normalizeCover(
  gateways: Pick<EventManagementGateways, "members" | "eventCovers">,
  organizer: CoverOrganizer,
  coverUploadId: string | null | undefined,
): Promise<Pick<EventEdit, "coverUploadId">> {
  const resolved = await resolveCoverUpload(gateways, organizer, coverUploadId);
  return resolved === undefined ? {} : { coverUploadId: resolved };
}

/** Las mismas reglas que al crear, sólo sobre lo que viene. También las usa
 * editar una serie (#315). */
export async function normalizeChanges(
  gateways: Pick<EventManagementGateways, "events" | "members" | "eventCovers">,
  organizer: CoverOrganizer,
  edit: EventEditDraft,
): Promise<EventEdit> {
  const { place, location, ...rest } = edit;
  const { clubId } = organizer;
  return {
    ...rest,
    ...(edit.title === undefined ? {} : { title: normalizeTitle(edit.title) }),
    ...normalizeWhere({ place, location }),
    ...(edit.placeDetail === undefined
      ? {}
      : { placeDetail: normalizePlaceDetail(edit.placeDetail) }),
    ...(edit.notes === undefined ? {} : { notes: normalizeNotes(edit.notes) }),
    ...(edit.audience === undefined
      ? {}
      : { audience: await resolveAudience(gateways, clubId, edit.audience) }),
    ...(await normalizeCover(gateways, organizer, edit.coverUploadId)),
  };
}

/** Los cambios con el fin que tendrá el evento después de editarlo, o por
 * qué no vale. Se exige aunque no se toque la hora: un evento anterior a E24
 * no se guarda sin hora de fin (D5). */
function withResolvedEnd(event: ManagedEvent, changes: EventEdit): EventEdit {
  const end = resolveEventEnd({
    startsOn: changes.startsOn ?? event.startsOn,
    startTime: changes.startTime ?? event.startTime,
    endTime: changes.endTime === undefined ? event.endTime : changes.endTime,
    endsOn: changes.endsOn === undefined ? event.endsOn : changes.endsOn,
    isSeriesSession: event.seriesId !== null,
  });
  return { ...changes, ...end };
}

/** La fecha y la hora que tendrá el evento después de editarlo. */
function assertStillAheadAfter(
  event: ManagedEvent,
  changes: EventEdit,
  now: Date,
): void {
  const session = {
    date: changes.startsOn ?? event.startsOn,
    time: changes.startTime ?? event.startTime,
  };
  if (!isStillAhead(session, clubMoment(now))) {
    throw new EventValidationError("event_in_past");
  }
}

/** Cambia lo que viene de un evento futuro, o dice por qué no. Si dos
 * organizadores guardan a la vez, queda lo del último. La audiencia se entera
 * si cambió la fecha, la hora o el lugar (#317). */
export async function editEvent(
  gateways: EventManagementGateways,
  request: {
    readonly callerId: string;
    readonly eventId: string;
    readonly changes: EventEditDraft;
    readonly now: Date;
  },
): Promise<ManagedEvent> {
  const caller = await findEventOrganizer(gateways, request.callerId);
  const target = { ...request, clubId: caller.clubId };
  const event = await findOpenEvent(gateways, target);
  const normalized = await normalizeChanges(
    gateways,
    { clubId: caller.clubId, userId: request.callerId },
    request.changes,
  );
  assertStillAheadAfter(event, normalized, request.now);
  const changes = withResolvedEnd(event, normalized);
  const write = await gateways.managedEvents.updateEvent({
    clubId: caller.clubId,
    eventId: request.eventId,
    changes,
  });
  const edited = await readBackEvent(gateways, target, write);
  await announceEventChange(gateways, {
    clubId: caller.clubId,
    authorId: request.callerId,
    before: event,
    after: edited,
  });
  return edited;
}

/** Marca cancelado un evento futuro, con la hora, sin borrar sus
 * respuestas, y se lo avisa a la audiencia (#317). */
export async function cancelEvent(
  gateways: EventManagementGateways,
  request: {
    readonly callerId: string;
    readonly eventId: string;
    readonly now: Date;
  },
): Promise<ManagedEvent> {
  const caller = await findEventOrganizer(gateways, request.callerId);
  const target = { ...request, clubId: caller.clubId };
  await findOpenEvent(gateways, target);
  const write = await gateways.managedEvents.cancelEvent({
    clubId: caller.clubId,
    eventId: request.eventId,
    cancelledAt: request.now,
  });
  const cancelled = await readBackEvent(gateways, target, write);
  await announceEventCancellation(gateways, {
    clubId: caller.clubId,
    authorId: request.callerId,
    cancelled,
  });
  return cancelled;
}
