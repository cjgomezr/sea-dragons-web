import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { clubMoment } from "@/lib/time/club-calendar";
import {
  type EventFields,
  type EventsGateway,
  EventValidationError,
  findEventOrganizer,
  normalizeLocation,
  normalizeNotes,
  normalizeTitle,
  resolveAudience,
} from "./event-creation";
import { isStillAhead } from "./event-occurrences";
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
} & ManagedEventState;

/** Lo que se puede cambiar de un evento; lo que no viene se queda igual. */
export type EventEdit = Partial<EventFields & { readonly startsOn: string }>;

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

export type EventManagementGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly events: Pick<EventsGateway, "findClubGroupIds">;
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

/** Las mismas reglas que al crear, sólo sobre lo que viene. */
async function normalizeChanges(
  gateways: Pick<EventManagementGateways, "events">,
  clubId: string,
  edit: EventEdit,
): Promise<EventEdit> {
  return {
    ...edit,
    ...(edit.title === undefined ? {} : { title: normalizeTitle(edit.title) }),
    ...(edit.location === undefined
      ? {}
      : { location: normalizeLocation(edit.location) }),
    ...(edit.notes === undefined ? {} : { notes: normalizeNotes(edit.notes) }),
    ...(edit.audience === undefined
      ? {}
      : { audience: await resolveAudience(gateways, clubId, edit.audience) }),
  };
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
 * organizadores guardan a la vez, queda lo del último. */
export async function editEvent(
  gateways: EventManagementGateways,
  request: {
    readonly callerId: string;
    readonly eventId: string;
    readonly changes: EventEdit;
    readonly now: Date;
  },
): Promise<ManagedEvent> {
  const caller = await findEventOrganizer(gateways, request.callerId);
  const target = { ...request, clubId: caller.clubId };
  const event = await findOpenEvent(gateways, target);
  const changes = await normalizeChanges(
    gateways,
    caller.clubId,
    request.changes,
  );
  assertStillAheadAfter(event, changes, request.now);
  const write = await gateways.managedEvents.updateEvent({
    clubId: caller.clubId,
    eventId: request.eventId,
    changes,
  });
  return readBackEvent(gateways, target, write);
}

/** Marca cancelado un evento futuro, con la hora, sin borrar sus
 * respuestas. */
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
  return readBackEvent(gateways, target, write);
}
