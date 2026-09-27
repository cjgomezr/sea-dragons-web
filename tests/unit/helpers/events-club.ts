import type { Role } from "@/lib/auth/roles";
import type {
  EventDraft,
  EventGateways,
  NewEventSchedule,
} from "@/lib/events/event-creation";

/**
 * Un club en memoria para los tests de crear eventos (#307). El doble cumple
 * el contrato del adaptador: guarda la serie y sus ocurrencias de una vez y
 * devuelve un id por fecha, en el mismo orden.
 */

export const CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
export const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
export const SENIOR_SQUAD_ID = "9a9a9a9a-0000-4000-8000-000000000009";
export const MASTERS_SQUAD_ID = "8b8b8b8b-0000-4000-8000-000000000008";
export const SAVED_SERIES_ID = "c2c2c2c2-0000-4000-8000-00000000000c";

/** 2027-06-15 10:00 en Melbourne (hora estándar, UTC+10). */
export const NOW = new Date("2027-06-15T00:00:00Z");

export function savedEventId(index: number): string {
  return `e${String(index).padStart(7, "0")}-0000-4000-8000-00000000000e`;
}

export const SINGLE_DRAFT: Extract<EventDraft, { repeat: "none" }> = {
  title: "Liga estatal",
  eventType: "competition",
  startTime: "10:00",
  location: "MSAC",
  notes: "Llevad gorro azul.",
  audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
  repeat: "none",
  startsOn: "2027-07-10",
};

export const WEEKLY_DRAFT: Extract<EventDraft, { repeat: "weekly" }> = {
  title: "Entrenamiento",
  eventType: "training",
  startTime: "19:00",
  location: "MSAC",
  notes: null,
  audience: { kind: "club" },
  repeat: "weekly",
  weekdays: [2, 4],
  startsOn: "2027-07-01",
  endsOn: "2027-08-31",
};

export type FakeEventsClubOptions = {
  readonly callerRole?: Role;
  readonly callerIsMember?: false;
  readonly clubGroupIds?: readonly string[];
};

export type FakeEventsClub = {
  readonly gateways: EventGateways;
  readonly saved: NewEventSchedule[];
};

export function fakeEventsClub(
  options: FakeEventsClubOptions = {},
): FakeEventsClub {
  const saved: NewEventSchedule[] = [];
  const clubGroupIds = options.clubGroupIds ?? [
    SENIOR_SQUAD_ID,
    MASTERS_SQUAD_ID,
  ];
  const gateways: EventGateways = {
    members: {
      findRoleRequestMember: async () =>
        options.callerIsMember === false
          ? null
          : {
              clubId: CLUB_ID,
              fullName: "Quien llama",
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
      insertSchedule: async (schedule) => {
        saved.push(schedule);
        return {
          seriesId: schedule.series === null ? null : SAVED_SERIES_ID,
          eventIds: schedule.occurrenceDates.map((_date, index) =>
            savedEventId(index),
          ),
        };
      },
    },
  };
  return { gateways, saved };
}
