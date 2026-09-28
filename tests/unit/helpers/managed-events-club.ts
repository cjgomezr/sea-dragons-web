import type { Role } from "@/lib/auth/roles";
import type {
  EventEdit,
  EventManagementGateways,
  ManagedEvent,
} from "@/lib/events/event-management";
import { clubMoment } from "@/lib/time/club-calendar";
import { isStillAhead } from "@/lib/events/event-occurrences";
import {
  CALLER_ID,
  CLUB_ID,
  MASTERS_SQUAD_ID,
  SENIOR_SQUAD_ID,
} from "./events-club";

/**
 * Un club en memoria para los tests de editar y cancelar eventos (#314). El
 * doble cumple el contrato del adaptador: sólo busca en el club que le
 * piden, escribe sólo lo que traen los cambios, sustituye la audiencia
 * entera y no toca un evento cancelado o que ya empezó. Las respuestas de
 * cada evento viven aparte y nadie las borra.
 */

export { CALLER_ID, CLUB_ID, MASTERS_SQUAD_ID, SENIOR_SQUAD_ID };

export const SINGLE_EVENT_ID = "e1e1e1e1-0000-4000-8000-00000000000e";
export const SERIES_ID = "c3c3c3c3-0000-4000-8000-00000000000c";
export const FIRST_OCCURRENCE_ID = "e2e2e2e2-0000-4000-8000-00000000000e";
export const SECOND_OCCURRENCE_ID = "e3e3e3e3-0000-4000-8000-00000000000e";
export const PAST_EVENT_ID = "e4e4e4e4-0000-4000-8000-00000000000e";
export const CANCELLED_EVENT_ID = "e5e5e5e5-0000-4000-8000-00000000000e";
export const MISSING_EVENT_ID = "e9e9e9e9-0000-4000-8000-00000000000e";

/** 2027-06-15 10:00 en Melbourne (hora estándar, UTC+10). */
export const NOW = new Date("2027-06-15T00:00:00Z");

/** Una Competition suelta para el Senior Squad, dentro de un mes. */
export const SINGLE_EVENT: ManagedEvent = {
  id: SINGLE_EVENT_ID,
  seriesId: null,
  title: "Liga estatal",
  eventType: "competition",
  startsOn: "2027-07-10",
  startTime: "10:00",
  location: "MSAC",
  notes: "Llevad gorro azul.",
  audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
  status: "scheduled",
};

const TRAINING_OCCURRENCE: Omit<
  Extract<ManagedEvent, { readonly status: "scheduled" }>,
  "id" | "startsOn"
> = {
  seriesId: SERIES_ID,
  title: "Entrenamiento",
  eventType: "training",
  startTime: "19:00",
  location: "MSAC",
  notes: null,
  audience: { kind: "club" },
  status: "scheduled",
};

function initialEvents(): readonly ManagedEvent[] {
  return [
    SINGLE_EVENT,
    { ...TRAINING_OCCURRENCE, id: FIRST_OCCURRENCE_ID, startsOn: "2027-07-06" },
    {
      ...TRAINING_OCCURRENCE,
      id: SECOND_OCCURRENCE_ID,
      startsOn: "2027-07-08",
    },
    { ...SINGLE_EVENT, id: PAST_EVENT_ID, startsOn: "2027-06-01" },
    {
      ...SINGLE_EVENT,
      id: CANCELLED_EVENT_ID,
      status: "cancelled",
      cancelledAt: "2027-06-10T00:00:00.000Z",
    },
  ];
}

export type FakeManagedEventsClubOptions = {
  readonly callerRole?: Role;
  readonly callerIsMember?: false;
  readonly clubGroupIds?: readonly string[];
  /** Un evento que alguien cancela justo después de que el dominio lo lea. */
  readonly cancelledMeanwhile?: string;
};

export type FakeManagedEventsClub = {
  readonly gateways: EventManagementGateways;
  /** El estado de cada evento, por id. */
  event(id: string): ManagedEvent | undefined;
  /** Las respuestas de cada evento, que editar y cancelar no tocan. */
  readonly rsvps: ReadonlyMap<string, readonly string[]>;
  /** Cuántas escrituras llegaron al adaptador. */
  writeCount(): number;
};

function applyChanges(event: ManagedEvent, changes: EventEdit): ManagedEvent {
  return { ...event, ...changes } as ManagedEvent;
}

function isOpen(event: ManagedEvent, now: Date): boolean {
  return (
    event.status === "scheduled" &&
    isStillAhead(
      { date: event.startsOn, time: event.startTime },
      clubMoment(now),
    )
  );
}

export function fakeManagedEventsClub(
  options: FakeManagedEventsClubOptions = {},
): FakeManagedEventsClub {
  const events = new Map(initialEvents().map((event) => [event.id, event]));
  const rsvps = new Map([[SINGLE_EVENT_ID, ["yes", "maybe"]]]);
  const clubGroupIds = options.clubGroupIds ?? [
    SENIOR_SQUAD_ID,
    MASTERS_SQUAD_ID,
  ];
  let writes = 0;
  const cancelMeanwhile = (id: string): void => {
    const event = events.get(id);
    if (options.cancelledMeanwhile === id && event !== undefined) {
      events.set(id, {
        ...event,
        status: "cancelled",
        cancelledAt: NOW.toISOString(),
      });
    }
  };
  const gateways: EventManagementGateways = {
    members: {
      findRoleRequestMember: async () =>
        options.callerIsMember === false
          ? null
          : {
              clubId: CLUB_ID,
              fullName: "Quien organiza",
              role: options.callerRole ?? "Committee",
            },
    },
    events: {
      findClubGroupIds: async ({ clubId, groupIds }) =>
        new Set(
          clubId === CLUB_ID
            ? groupIds.filter((id) => clubGroupIds.includes(id))
            : [],
        ),
    },
    managedEvents: {
      findEvent: async ({ clubId, eventId }) => {
        const event = clubId === CLUB_ID ? events.get(eventId) : undefined;
        cancelMeanwhile(eventId);
        return event ?? null;
      },
      updateEvent: async ({ eventId, changes }) => {
        writes += 1;
        const event = events.get(eventId);
        if (event === undefined || !isOpen(event, NOW)) {
          return "closed";
        }
        events.set(eventId, applyChanges(event, changes));
        return "saved";
      },
      cancelEvent: async ({ eventId, cancelledAt }) => {
        writes += 1;
        const event = events.get(eventId);
        if (event === undefined || !isOpen(event, cancelledAt)) {
          return "closed";
        }
        events.set(eventId, {
          ...event,
          status: "cancelled",
          cancelledAt: cancelledAt.toISOString(),
        });
        return "saved";
      },
    },
  };
  return {
    gateways,
    event: (id) => events.get(id),
    rsvps,
    writeCount: () => writes,
  };
}
