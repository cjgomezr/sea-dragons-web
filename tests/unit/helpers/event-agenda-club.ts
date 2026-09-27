import type { Role } from "@/lib/auth/roles";
import type {
  AgendaQuery,
  EventAgendaGateways,
  EventRow,
  Responder,
  RsvpTally,
} from "@/lib/events/event-agenda";

/**
 * Un club en memoria para los tests de la agenda y el detalle (#309). El
 * doble cumple el contrato del adaptador: sólo devuelve eventos del club que
 * se le pide, aplica la visibilidad, el periodo, el orden y el cursor como la
 * consulta, y corta en el límite. Los conteos y los nombres los da tal cual:
 * quién cuenta lo decide la base (`0039_event_rsvp_tallies.sql`), y eso se
 * prueba en su migración.
 */

export const AGENDA_CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
export const AGENDA_CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
export const OTHER_CLUB_ID = "5c1ab000-0000-4000-8000-000000000002";
export const SENIOR_SQUAD = {
  id: "9a9a9a9a-0000-4000-8000-000000000009",
  name: "Senior Squad",
} as const;
export const MASTERS_SQUAD = {
  id: "8b8b8b8b-0000-4000-8000-000000000008",
  name: "Masters",
} as const;

/** 2027-06-15 10:00 en Melbourne (hora estándar, UTC+10). */
export const AGENDA_NOW = new Date("2027-06-15T00:00:00Z");

export type FakeEvent = EventRow & { readonly clubId: string };

let eventCounter = 0;

/** Un id de evento que ordena igual que el orden en que se crea. */
function nextEventId(): string {
  eventCounter += 1;
  return `e0000000-0000-4000-8000-${String(eventCounter).padStart(12, "0")}`;
}

/** Un entrenamiento para todo el club a las 19:00 de Melbourne del día que
 * se pide. El instante sale de la fecha con UTC+10, que en junio es exacto. */
export function clubEvent(
  startsOn: string,
  overrides: Partial<FakeEvent> = {},
): FakeEvent {
  const [year, month, day] = startsOn.split("-").map(Number);
  const startsAt = new Date(
    Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, 9),
  ).toISOString();
  return {
    id: nextEventId(),
    clubId: AGENDA_CLUB_ID,
    startsOn,
    startTime: "19:00",
    startsAt,
    title: "Entrenamiento",
    eventType: "training",
    location: "MSAC",
    notes: null,
    status: "scheduled",
    seriesId: null,
    audience: { kind: "club" },
    myResponse: null,
    ...overrides,
  };
}

export function seniorSquadEvent(
  startsOn: string,
  overrides: Partial<FakeEvent> = {},
): FakeEvent {
  return clubEvent(startsOn, {
    title: "Senior Squad",
    audience: { kind: "groups", groups: [SENIOR_SQUAD] },
    ...overrides,
  });
}

export type FakeAgendaClubOptions = {
  readonly callerRole?: Role;
  readonly callerIsMember?: false;
  readonly callerGroupIds?: readonly string[];
  readonly events?: readonly FakeEvent[];
  readonly tallies?: readonly RsvpTally[];
  readonly responders?: Readonly<Record<string, readonly Responder[]>>;
};

export type FakeAgendaClub = {
  readonly gateways: EventAgendaGateways;
  /** Los ids de cada llamada a los conteos, en orden. */
  readonly tallyCalls: (readonly string[])[];
};

function isVisible(event: FakeEvent, query: AgendaQuery): boolean {
  if (query.visibility.kind === "club" || event.audience.kind === "club") {
    return true;
  }
  const { groupIds } = query.visibility;
  return event.audience.groups.some((group) => groupIds.includes(group.id));
}

function isInPeriod(event: FakeEvent, query: AgendaQuery): boolean {
  return query.period === "upcoming"
    ? event.startsOn >= query.today
    : event.startsOn < query.today;
}

function compareAscending(first: FakeEvent, second: FakeEvent): number {
  return (
    first.startsAt.localeCompare(second.startsAt) ||
    first.id.localeCompare(second.id)
  );
}

function isAfterCursor(event: FakeEvent, query: AgendaQuery): boolean {
  if (query.after === null) {
    return true;
  }
  const order = compareAscending(event, {
    ...event,
    startsAt: query.after.startsAt,
    id: query.after.id,
  });
  return query.period === "upcoming" ? order > 0 : order < 0;
}

function findAgendaPage(
  events: readonly FakeEvent[],
  query: AgendaQuery,
): readonly EventRow[] {
  const direction = query.period === "upcoming" ? 1 : -1;
  return events
    .filter(
      (event) =>
        event.clubId === query.clubId &&
        isVisible(event, query) &&
        isInPeriod(event, query) &&
        isAfterCursor(event, query),
    )
    .sort((first, second) => direction * compareAscending(first, second))
    .slice(0, query.limit);
}

export function fakeAgendaClub(
  options: FakeAgendaClubOptions = {},
): FakeAgendaClub {
  const events = options.events ?? [];
  const tallyCalls: (readonly string[])[] = [];
  const gateways: EventAgendaGateways = {
    members: {
      findRoleRequestMember: async () =>
        options.callerIsMember === false
          ? null
          : {
              clubId: AGENDA_CLUB_ID,
              fullName: "Quien consulta",
              role: options.callerRole ?? "Player",
            },
    },
    memberGroups: {
      listGroupsOf: async () =>
        (options.callerGroupIds ?? []).map((id) => ({ id, name: id })),
    },
    agenda: {
      findAgendaPage: async (query) => findAgendaPage(events, query),
      findEvent: async ({ clubId, eventId }) =>
        events.find(
          (event) => event.id === eventId && event.clubId === clubId,
        ) ?? null,
      countResponses: async (eventIds) => {
        tallyCalls.push(eventIds);
        return (options.tallies ?? []).filter((tally) =>
          eventIds.includes(tally.eventId),
        );
      },
      listResponders: async (eventId) => options.responders?.[eventId] ?? [],
    },
  };
  return { gateways, tallyCalls };
}
