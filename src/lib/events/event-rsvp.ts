import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import type { MemberGroupsGateway } from "@/lib/groups/member-groups";
import type { EventAudience } from "./event-creation";

/**
 * Responder a un evento (#308, RF-5 del PRD de E7, FR-034 y FR-035), contado
 * sin Supabase delante.
 *
 * Responde cualquier miembro de la audiencia, sea cual sea su rol: la
 * participación sale del RSVP y de los grupos, nunca del rol (B7). Por eso un
 * Admin o un Committee fuera de la audiencia recibe lo mismo que cualquiera:
 * que el evento no existe. Con un "prohibido" distinto se podrían recorrer ids
 * y enumerar qué eventos tiene el club (AC-052).
 */

/** Los mismos que acepta el `check` de `event_rsvps.response` en
 * `0037_event_rsvps.sql` (FR-034). */
export const RSVP_RESPONSES = ["yes", "maybe", "no"] as const;

export type RsvpResponse = (typeof RSVP_RESPONSES)[number];

/** Lo que hace falta de un evento para decidir si se le puede responder. */
export type RsvpEvent = {
  readonly id: string;
  readonly clubId: string;
  readonly status: "scheduled" | "cancelled";
  readonly startsAt: Date;
  readonly audience: EventAudience;
};

/** Lo que se guarda: una fila por evento y miembro, con la hora de la última
 * respuesta. */
export type NewEventRsvp = {
  readonly clubId: string;
  readonly eventId: string;
  readonly userId: string;
  readonly response: RsvpResponse;
  readonly respondedAt: Date;
};

export type EventRsvp = {
  readonly eventId: string;
  readonly response: RsvpResponse;
  readonly respondedAt: string;
};

export type EventRsvpsGateway = {
  /** El evento, si es de ese club. */
  findEvent(query: {
    readonly clubId: string;
    readonly eventId: string;
  }): Promise<RsvpEvent | null>;
  /** Reescribe la respuesta anterior del miembro, si la había: dos llamadas
   * iguales a la vez dejan una sola fila. */
  saveResponse(rsvp: NewEventRsvp): Promise<void>;
};

export type EventRsvpGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly memberGroups: MemberGroupsGateway;
  readonly rsvps: EventRsvpsGateway;
};

export class EventNotFoundError extends Error {
  constructor() {
    super("El evento no existe.");
    this.name = "EventNotFoundError";
  }
}

/** Van en `reason` del 422, para que la pantalla (#311) los traduzca. */
export type RsvpClosedCode = "rsvp_event_started" | "rsvp_event_cancelled";

const CLOSED_MESSAGES: Readonly<Record<RsvpClosedCode, string>> = {
  rsvp_event_started: "El evento ya empezó: ya no se puede responder.",
  rsvp_event_cancelled: "El evento está cancelado: ya no se puede responder.",
};

export class RsvpClosedError extends Error {
  readonly code: RsvpClosedCode;

  constructor(code: RsvpClosedCode) {
    super(CLOSED_MESSAGES[code]);
    this.name = "RsvpClosedError";
    this.code = code;
  }
}

function isInAudience(
  audience: EventAudience,
  memberGroupIds: readonly string[],
): boolean {
  return (
    audience.kind === "club" ||
    audience.groupIds.some((id) => memberGroupIds.includes(id))
  );
}

/** El evento al que quien llama puede responder ahora, o por qué no. Quien
 * está fuera de la audiencia no llega a saber si está cancelado o empezado. */
async function findOpenEvent(
  gateways: EventRsvpGateways,
  request: {
    readonly clubId: string;
    readonly callerId: string;
    readonly eventId: string;
    readonly now: Date;
  },
): Promise<RsvpEvent> {
  const [event, groups] = await Promise.all([
    gateways.rsvps.findEvent({
      clubId: request.clubId,
      eventId: request.eventId,
    }),
    gateways.memberGroups.listGroupsOf(request.callerId),
  ]);
  const groupIds = groups.map((group) => group.id);
  if (event === null || !isInAudience(event.audience, groupIds)) {
    throw new EventNotFoundError();
  }
  if (event.status === "cancelled") {
    throw new RsvpClosedError("rsvp_event_cancelled");
  }
  if (event.startsAt.getTime() <= request.now.getTime()) {
    throw new RsvpClosedError("rsvp_event_started");
  }
  return event;
}

/** Guarda la respuesta de quien llama a una ocurrencia, o dice por qué no. El
 * club sale de su fila de miembro, nunca de la petición (NFR-009). */
export async function respondToEvent(
  gateways: EventRsvpGateways,
  request: {
    readonly callerId: string;
    readonly eventId: string;
    readonly response: RsvpResponse;
    readonly now: Date;
  },
): Promise<EventRsvp> {
  const caller = await gateways.members.findRoleRequestMember(request.callerId);
  if (caller === null) {
    throw new MemberNotFoundError(request.callerId);
  }
  const event = await findOpenEvent(gateways, {
    ...request,
    clubId: caller.clubId,
  });
  await gateways.rsvps.saveResponse({
    clubId: caller.clubId,
    eventId: event.id,
    userId: request.callerId,
    response: request.response,
    respondedAt: request.now,
  });
  return {
    eventId: event.id,
    response: request.response,
    respondedAt: request.now.toISOString(),
  };
}
