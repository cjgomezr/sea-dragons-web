import type { Role } from "@/lib/auth/roles";
import type {
  EventRsvpGateways,
  NewEventRsvp,
  RsvpEvent,
} from "@/lib/events/event-rsvp";

/**
 * Un club en memoria para los tests del RSVP (#308). El doble cumple el
 * contrato del adaptador: sólo encuentra eventos del club que se le pide, y
 * guardar dos veces la misma respuesta deja una sola, como el upsert sobre la
 * clave primaria.
 */

export const RSVP_CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
export const RSVP_CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
export const OTHER_CLUB_ID = "5c1ab000-0000-4000-8000-000000000002";
export const SENIOR_SQUAD_ID = "9a9a9a9a-0000-4000-8000-000000000009";
export const MASTERS_SQUAD_ID = "8b8b8b8b-0000-4000-8000-000000000008";
export const CLUB_EVENT_ID = "e1e1e1e1-0000-4000-8000-00000000000e";

/** 2027-06-15 10:00 en Melbourne (hora estándar, UTC+10). */
export const RSVP_NOW = new Date("2027-06-15T00:00:00Z");

/** Un entrenamiento para todo el club, el martes siguiente a las 19:00. */
export const UPCOMING_EVENT: RsvpEvent = {
  id: CLUB_EVENT_ID,
  clubId: RSVP_CLUB_ID,
  status: "scheduled",
  startsAt: new Date("2027-06-22T09:00:00Z"),
  audience: { kind: "club" },
};

export type FakeRsvpClubOptions = {
  readonly callerRole?: Role;
  readonly callerIsMember?: false;
  readonly callerGroupIds?: readonly string[];
  readonly events?: readonly RsvpEvent[];
};

export type FakeRsvpClub = {
  readonly gateways: EventRsvpGateways;
  /** Una fila por evento y miembro, como la clave primaria. */
  readonly saved: Map<string, NewEventRsvp>;
};

export function fakeRsvpClub(options: FakeRsvpClubOptions = {}): FakeRsvpClub {
  const saved = new Map<string, NewEventRsvp>();
  const events = options.events ?? [UPCOMING_EVENT];
  const gateways: EventRsvpGateways = {
    members: {
      findRoleRequestMember: async () =>
        options.callerIsMember === false
          ? null
          : {
              clubId: RSVP_CLUB_ID,
              fullName: "Quien responde",
              role: options.callerRole ?? "Player",
            },
    },
    memberGroups: {
      listGroupsOf: async () =>
        (options.callerGroupIds ?? []).map((id) => ({ id, name: id })),
    },
    rsvps: {
      findEvent: async ({ clubId, eventId }) =>
        events.find(
          (event) => event.id === eventId && event.clubId === clubId,
        ) ?? null,
      saveResponse: async (rsvp) => {
        saved.set(`${rsvp.eventId}|${rsvp.userId}`, rsvp);
      },
    },
  };
  return { gateways, saved };
}
