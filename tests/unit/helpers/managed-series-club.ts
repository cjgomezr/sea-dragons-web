import type { Role } from "@/lib/auth/roles";
import type { ManagedEvent } from "@/lib/events/event-management";
import { isStillAhead } from "@/lib/events/event-occurrences";
import type {
  ManagedSeries,
  SeriesManagementGateways,
} from "@/lib/events/series-management";
import { clubMoment } from "@/lib/time/club-calendar";
import {
  CALLER_ID,
  CLUB_ID,
  MASTERS_SQUAD_ID,
  SENIOR_SQUAD_ID,
} from "./events-club";

/**
 * Un club en memoria para los tests de editar y cancelar una serie (#315).
 * El doble cumple el contrato del adaptador: sólo busca en el club que le
 * piden, toca sólo las ocurrencias futuras no canceladas (las editadas solas
 * incluidas) y, si no hay ninguna, no escribe nada, ni siquiera la serie.
 * Las respuestas de cada ocurrencia viven aparte y nadie las borra.
 */

export { CALLER_ID, CLUB_ID, MASTERS_SQUAD_ID, SENIOR_SQUAD_ID };

export const SERIES_ID = "c3c3c3c3-0000-4000-8000-00000000000c";
/** Una serie cuyas ocurrencias ya pasaron o están canceladas. */
export const SPENT_SERIES_ID = "c4c4c4c4-0000-4000-8000-00000000000c";
export const MISSING_SERIES_ID = "c9c9c9c9-0000-4000-8000-00000000000c";

export const PAST_OCCURRENCE_ID = "e1e1e1e1-0000-4000-8000-00000000000e";
export const CANCELLED_OCCURRENCE_ID = "e2e2e2e2-0000-4000-8000-00000000000e";
/** Futura, editada sola antes: otra hora y otras notas. */
export const EDITED_OCCURRENCE_ID = "e3e3e3e3-0000-4000-8000-00000000000e";
export const UPCOMING_OCCURRENCE_ID = "e4e4e4e4-0000-4000-8000-00000000000e";
export const SPENT_OCCURRENCE_ID = "e5e5e5e5-0000-4000-8000-00000000000e";

/** 2027-06-15 10:00 en Melbourne (hora estándar, UTC+10). */
export const NOW = new Date("2027-06-15T00:00:00Z");

/** Entrenamiento de martes y jueves para todo el club, junio y julio. */
export const SERIES: ManagedSeries = {
  id: SERIES_ID,
  title: "Entrenamiento",
  eventType: "training",
  startTime: "19:00",
  location: "MSAC",
  notes: null,
  audience: { kind: "club" },
  weekdays: [2, 4],
  startsOn: "2027-06-01",
  endsOn: "2027-07-29",
};

const SPENT_SERIES: ManagedSeries = {
  ...SERIES,
  id: SPENT_SERIES_ID,
  startsOn: "2027-05-04",
  endsOn: "2027-06-24",
};

function occurrenceOf(
  series: ManagedSeries,
  occurrence: { readonly id: string; readonly startsOn: string },
): ManagedEvent {
  return {
    title: series.title,
    eventType: series.eventType,
    startTime: series.startTime,
    location: series.location,
    notes: series.notes,
    audience: series.audience,
    ...occurrence,
    seriesId: series.id,
    status: "scheduled",
  };
}

function initialOccurrences(): readonly ManagedEvent[] {
  return [
    occurrenceOf(SERIES, { id: PAST_OCCURRENCE_ID, startsOn: "2027-06-01" }),
    {
      ...occurrenceOf(SERIES, {
        id: CANCELLED_OCCURRENCE_ID,
        startsOn: "2027-06-17",
      }),
      status: "cancelled",
      cancelledAt: "2027-06-10T00:00:00.000Z",
    },
    {
      ...occurrenceOf(SERIES, {
        id: EDITED_OCCURRENCE_ID,
        startsOn: "2027-06-22",
      }),
      startTime: "18:30",
      notes: "Piscina 2",
    },
    occurrenceOf(SERIES, {
      id: UPCOMING_OCCURRENCE_ID,
      startsOn: "2027-06-24",
    }),
    {
      ...occurrenceOf(SPENT_SERIES, {
        id: SPENT_OCCURRENCE_ID,
        startsOn: "2027-06-24",
      }),
      status: "cancelled",
      cancelledAt: "2027-06-10T00:00:00.000Z",
    },
  ];
}

export type FakeManagedSeriesClubOptions = {
  readonly callerRole?: Role;
  readonly clubGroupIds?: readonly string[];
  /** Una escritura que revienta en la base. */
  readonly failingWrites?: true;
};

export type FakeManagedSeriesClub = {
  readonly gateways: SeriesManagementGateways;
  series(id: string): ManagedSeries | undefined;
  occurrence(id: string): ManagedEvent | undefined;
  /** Las respuestas de cada ocurrencia, que editar y cancelar no tocan. */
  readonly rsvps: ReadonlyMap<string, readonly string[]>;
  /** Cuántas escrituras llegaron al adaptador. */
  writeCount(): number;
};

function isOpen(event: ManagedEvent, now: Date): boolean {
  return (
    event.status === "scheduled" &&
    isStillAhead(
      { date: event.startsOn, time: event.startTime },
      clubMoment(now),
    )
  );
}

export function fakeManagedSeriesClub(
  options: FakeManagedSeriesClubOptions = {},
): FakeManagedSeriesClub {
  const allSeries = new Map(
    [SERIES, SPENT_SERIES].map((series) => [series.id, series]),
  );
  const occurrences = new Map(
    initialOccurrences().map((event) => [event.id, event]),
  );
  const rsvps = new Map([[UPCOMING_OCCURRENCE_ID, ["yes", "maybe"]]]);
  const clubGroupIds = options.clubGroupIds ?? [
    SENIOR_SQUAD_ID,
    MASTERS_SQUAD_ID,
  ];
  let writes = 0;
  const openOccurrencesOf = (
    seriesId: string,
    now: Date,
  ): readonly ManagedEvent[] =>
    [...occurrences.values()].filter(
      (event) => event.seriesId === seriesId && isOpen(event, now),
    );
  const startWrite = (): void => {
    writes += 1;
    if (options.failingWrites) {
      throw new Error("La base se cayó a mitad de la escritura.");
    }
  };
  const gateways: SeriesManagementGateways = {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Quien organiza",
        role: options.callerRole ?? "Committee",
      }),
    },
    events: {
      findClubGroupIds: async ({ clubId, groupIds }) =>
        new Set(
          clubId === CLUB_ID
            ? groupIds.filter((id) => clubGroupIds.includes(id))
            : [],
        ),
    },
    managedSeries: {
      findSeries: async ({ clubId, seriesId }) =>
        (clubId === CLUB_ID ? allSeries.get(seriesId) : undefined) ?? null,
      updateSeries: async ({ seriesId, changes }) => {
        startWrite();
        const open = openOccurrencesOf(seriesId, NOW);
        const series = allSeries.get(seriesId);
        if (open.length === 0 || series === undefined) {
          return 0;
        }
        allSeries.set(seriesId, { ...series, ...changes });
        for (const event of open) {
          occurrences.set(event.id, { ...event, ...changes });
        }
        return open.length;
      },
      cancelSeries: async ({ seriesId, cancelledAt }) => {
        startWrite();
        const open = openOccurrencesOf(seriesId, cancelledAt);
        for (const event of open) {
          occurrences.set(event.id, {
            ...event,
            status: "cancelled",
            cancelledAt: cancelledAt.toISOString(),
          });
        }
        return open.length;
      },
    },
  };
  return {
    gateways,
    series: (id) => allSeries.get(id),
    occurrence: (id) => occurrences.get(id),
    rsvps,
    writeCount: () => writes,
  };
}
