import type { Role } from "@/lib/auth/roles";
import type { ManagedEvent } from "@/lib/events/event-management";
import { isStillAhead } from "@/lib/events/event-occurrences";
import type {
  ManagedSeries,
  SeriesEdit,
  SeriesManagementGateways,
  SeriesReschedule,
  SeriesSplit,
} from "@/lib/events/series-management";
import { clubMoment } from "@/lib/time/club-calendar";
import {
  CALLER_ID,
  CLUB_ID,
  type FakeNoticeOptions,
  type FakeNotices,
  MASTERS_SQUAD_ID,
  SENIOR_SQUAD_ID,
  fakeEventNotices,
} from "./events-club";
import { fakeEventCovers, findCoverUploader } from "./event-covers-club";

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
/** Creada antes de E24: no dice cuándo terminan sus sesiones (D5). */
export const LEGACY_SERIES_ID = "c5c5c5c5-0000-4000-8000-00000000000c";

export const PAST_OCCURRENCE_ID = "e1e1e1e1-0000-4000-8000-00000000000e";
export const CANCELLED_OCCURRENCE_ID = "e2e2e2e2-0000-4000-8000-00000000000e";
/** Futura, editada sola antes: otra hora y otras notas. */
export const EDITED_OCCURRENCE_ID = "e3e3e3e3-0000-4000-8000-00000000000e";
export const UPCOMING_OCCURRENCE_ID = "e4e4e4e4-0000-4000-8000-00000000000e";
export const SPENT_OCCURRENCE_ID = "e5e5e5e5-0000-4000-8000-00000000000e";
export const LEGACY_OCCURRENCE_ID = "e6e6e6e6-0000-4000-8000-00000000000e";

/** La que se parte (#653): una sesión pasada y otra futura antes de la
 * elegida; desde ella, una cancelada, una editada sola y otra. */
export const SPLIT_SERIES_ID = "c6c6c6c6-0000-4000-8000-00000000000c";
export const SPLIT_PAST_OCCURRENCE_ID = "f1f1f1f1-0000-4000-8000-00000000000f";
export const SPLIT_EARLIER_OCCURRENCE_ID =
  "f2f2f2f2-0000-4000-8000-00000000000f";
export const SPLIT_FROM_OCCURRENCE_ID = "f3f3f3f3-0000-4000-8000-00000000000f";
export const SPLIT_CANCELLED_OCCURRENCE_ID =
  "f4f4f4f4-0000-4000-8000-00000000000f";
export const SPLIT_EDITED_OCCURRENCE_ID =
  "f5f5f5f5-0000-4000-8000-00000000000f";
export const SPLIT_LATER_OCCURRENCE_ID = "f6f6f6f6-0000-4000-8000-00000000000f";
/** Un viernes cancelado cuando la serie dejó de ir los viernes (#654), con
 * una hora vieja: si vuelve, vuelve con la de la serie. */
export const SPLIT_DROPPED_FRIDAY_OCCURRENCE_ID =
  "f9f9f9f9-0000-4000-8000-00000000000f";
/** El id que recibe la serie que nace al partir. */
export const NEW_SERIES_ID = "c7c7c7c7-0000-4000-8000-00000000000c";
/** Una serie que todavía no empezó: partir desde su primera sesión la edita
 * entera. */
export const FRESH_SERIES_ID = "c8c8c8c8-0000-4000-8000-00000000000c";
export const FRESH_FIRST_OCCURRENCE_ID = "f7f7f7f7-0000-4000-8000-00000000000f";
export const FRESH_SECOND_OCCURRENCE_ID =
  "f8f8f8f8-0000-4000-8000-00000000000f";

/** 2027-06-15 10:00 en Melbourne (hora estándar, UTC+10). */
export const NOW = new Date("2027-06-15T00:00:00Z");

/** Entrenamiento de martes y jueves para todo el club, junio y julio. */
export const SERIES: ManagedSeries = {
  id: SERIES_ID,
  title: "Entrenamiento",
  eventType: "training",
  startTime: "19:00",
  endTime: "20:30",
  location: "MSAC",
  place: null,
  placeDetail: null,
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

const LEGACY_SERIES: ManagedSeries = {
  ...SERIES,
  id: LEGACY_SERIES_ID,
  endTime: null,
};

export const SPLIT_SERIES: ManagedSeries = { ...SERIES, id: SPLIT_SERIES_ID };

const FRESH_SERIES: ManagedSeries = {
  ...SERIES,
  id: FRESH_SERIES_ID,
  startsOn: "2027-06-22",
};

function occurrenceOf(
  series: ManagedSeries,
  occurrence: { readonly id: string; readonly startsOn: string },
): ManagedEvent {
  return {
    title: series.title,
    eventType: series.eventType,
    startTime: series.startTime,
    endTime: series.endTime,
    endsOn: null,
    location: series.location,
    place: series.place,
    placeDetail: series.placeDetail,
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
      endTime: "20:00",
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
    occurrenceOf(LEGACY_SERIES, {
      id: LEGACY_OCCURRENCE_ID,
      startsOn: "2027-06-24",
    }),
    ...splitOccurrences(),
  ];
}

function splitOccurrences(): readonly ManagedEvent[] {
  return [
    occurrenceOf(SPLIT_SERIES, {
      id: SPLIT_PAST_OCCURRENCE_ID,
      startsOn: "2027-06-01",
    }),
    occurrenceOf(SPLIT_SERIES, {
      id: SPLIT_EARLIER_OCCURRENCE_ID,
      startsOn: "2027-06-17",
    }),
    occurrenceOf(SPLIT_SERIES, {
      id: SPLIT_FROM_OCCURRENCE_ID,
      startsOn: "2027-06-22",
    }),
    {
      ...occurrenceOf(SPLIT_SERIES, {
        id: SPLIT_CANCELLED_OCCURRENCE_ID,
        startsOn: "2027-06-24",
      }),
      status: "cancelled",
      cancelledAt: "2027-06-10T00:00:00.000Z",
    },
    {
      ...occurrenceOf(SPLIT_SERIES, {
        id: SPLIT_EDITED_OCCURRENCE_ID,
        startsOn: "2027-06-29",
      }),
      startTime: "18:30",
      notes: "Piscina 2",
    },
    occurrenceOf(SPLIT_SERIES, {
      id: SPLIT_LATER_OCCURRENCE_ID,
      startsOn: "2027-07-01",
    }),
    {
      ...occurrenceOf(SPLIT_SERIES, {
        id: SPLIT_DROPPED_FRIDAY_OCCURRENCE_ID,
        startsOn: "2027-07-02",
      }),
      startTime: "18:00",
      status: "cancelled",
      cancelledAt: "2027-06-01T00:00:00.000Z",
    },
    occurrenceOf(FRESH_SERIES, {
      id: FRESH_FIRST_OCCURRENCE_ID,
      startsOn: "2027-06-22",
    }),
    occurrenceOf(FRESH_SERIES, {
      id: FRESH_SECOND_OCCURRENCE_ID,
      startsOn: "2027-06-24",
    }),
  ];
}

export type FakeManagedSeriesClubOptions = FakeNoticeOptions & {
  readonly callerRole?: Role;
  readonly clubGroupIds?: readonly string[];
  /** Una escritura que revienta en la base. */
  readonly failingWrites?: true;
};

export type FakeManagedSeriesClub = FakeNotices & {
  readonly gateways: SeriesManagementGateways;
  series(id: string): ManagedSeries | undefined;
  occurrence(id: string): ManagedEvent | undefined;
  /** Las sesiones de una serie, por fecha. */
  occurrencesOf(seriesId: string): readonly ManagedEvent[];
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

type SeriesStore = {
  readonly allSeries: Map<string, ManagedSeries>;
  readonly occurrences: Map<string, ManagedEvent>;
};

/** Lo que hace `update_series`: los cambios a la serie y a sus ocurrencias
 * futuras no canceladas; sin ninguna, no escribe nada. */
function applyToOpenOccurrences(
  store: SeriesStore,
  seriesId: string,
  changes: SeriesEdit,
): number {
  const open = [...store.occurrences.values()].filter(
    (event) => event.seriesId === seriesId && isOpen(event, NOW),
  );
  const series = store.allSeries.get(seriesId);
  if (open.length === 0 || series === undefined) {
    return 0;
  }
  store.allSeries.set(seriesId, { ...series, ...changes });
  for (const event of open) {
    store.occurrences.set(event.id, { ...event, ...changes });
  }
  return open.length;
}

function dayBefore(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Lo que hace `split_series` con días o fecha final nuevos (#654): cancela
 * las sesiones que ya no encajan, reactiva las canceladas de una fecha nueva
 * con los campos de la serie y crea las que faltan. Dice cuántas canceló. */
function rescheduleStoredSeries(
  store: SeriesStore,
  reschedule: SeriesReschedule & {
    readonly seriesId: string;
    readonly fromDay: string;
  },
): number {
  const series = store.allSeries.get(reschedule.seriesId);
  if (series === undefined) {
    return 0;
  }
  const { weekdays, endsOn, sessionDates, addedDates } = reschedule;
  store.allSeries.set(series.id, { ...series, weekdays, endsOn });
  const following = [...store.occurrences.values()].filter(
    (event) =>
      event.seriesId === series.id && event.startsOn >= reschedule.fromDay,
  );
  const leaving = following.filter(
    (event) => isOpen(event, NOW) && !sessionDates.includes(event.startsOn),
  );
  for (const event of leaving) {
    store.occurrences.set(event.id, {
      ...event,
      status: "cancelled",
      cancelledAt: NOW.toISOString(),
    });
  }
  for (const startsOn of addedDates) {
    const existing = following.find((event) => event.startsOn === startsOn);
    if (existing === undefined || existing.status === "cancelled") {
      const id = existing?.id ?? crypto.randomUUID();
      store.occurrences.set(id, occurrenceOf(series, { id, startsOn }));
    }
  }
  return leaving.length;
}

type StoredSplit = {
  readonly clubId: string;
  readonly seriesId: string;
  readonly fromOccurrenceId: string;
  readonly changes: SeriesEdit;
  readonly schedule: SeriesReschedule | null;
};

/** Reprograma si hace falta y aplica los cambios a las abiertas. */
function writeStoredSplit(
  store: SeriesStore,
  split: StoredSplit & { readonly fromDay: string },
): number {
  const cancelled =
    split.schedule === null
      ? 0
      : rescheduleStoredSeries(store, {
          ...split.schedule,
          seriesId: split.seriesId,
          fromDay: split.fromDay,
        });
  return (
    cancelled + applyToOpenOccurrences(store, split.seriesId, split.changes)
  );
}

/** Lo que hace `split_series` (#653): mueve a una serie nueva las ocurrencias
 * desde la elegida y le aplica los cambios, o edita la entera si la elegida
 * es la primera. */
function splitStoredSeries(
  store: SeriesStore,
  split: StoredSplit,
): SeriesSplit {
  const series = store.allSeries.get(split.seriesId);
  const from = store.occurrences.get(split.fromOccurrenceId);
  if (
    split.clubId !== CLUB_ID ||
    series === undefined ||
    from?.seriesId !== split.seriesId
  ) {
    return { kind: "session_not_in_series" };
  }
  if (
    !isStillAhead(
      { date: from.startsOn, time: from.startTime },
      clubMoment(NOW),
    )
  ) {
    return { kind: "occurrence_started" };
  }
  const ofSeries = [...store.occurrences.values()].filter(
    (event) => event.seriesId === split.seriesId,
  );
  const moved = ofSeries.filter((event) => event.startsOn >= from.startsOn);
  if (moved.length === ofSeries.length) {
    return {
      kind: "edited",
      seriesId: split.seriesId,
      updatedOccurrences: writeStoredSplit(store, {
        ...split,
        fromDay: from.startsOn,
      }),
    };
  }
  const isAddingSessions = (split.schedule?.addedDates.length ?? 0) > 0;
  if (!isAddingSessions && !moved.some((event) => isOpen(event, NOW))) {
    return { kind: "edited", seriesId: split.seriesId, updatedOccurrences: 0 };
  }
  store.allSeries.set(split.seriesId, {
    ...series,
    endsOn: dayBefore(from.startsOn),
  });
  store.allSeries.set(NEW_SERIES_ID, {
    ...series,
    id: NEW_SERIES_ID,
    startsOn: from.startsOn,
  });
  for (const event of moved) {
    store.occurrences.set(event.id, { ...event, seriesId: NEW_SERIES_ID });
  }
  return {
    kind: "split",
    seriesId: NEW_SERIES_ID,
    updatedOccurrences: writeStoredSplit(store, {
      ...split,
      seriesId: NEW_SERIES_ID,
      fromDay: from.startsOn,
    }),
  };
}

export function fakeManagedSeriesClub(
  options: FakeManagedSeriesClubOptions = {},
): FakeManagedSeriesClub {
  const allSeries = new Map(
    [SERIES, SPENT_SERIES, LEGACY_SERIES, SPLIT_SERIES, FRESH_SERIES].map(
      (series) => [series.id, series],
    ),
  );
  const occurrences = new Map(
    initialOccurrences().map((event) => [event.id, event]),
  );
  const store: SeriesStore = { allSeries, occurrences };
  const rsvps = new Map([
    [UPCOMING_OCCURRENCE_ID, ["yes", "maybe"]],
    [SPLIT_FROM_OCCURRENCE_ID, ["yes", "no"]],
  ]);
  const clubGroupIds = options.clubGroupIds ?? [
    SENIOR_SQUAD_ID,
    MASTERS_SQUAD_ID,
  ];
  let writes = 0;
  const { notices, noticeBatches, ...noticeGateways } =
    fakeEventNotices(options);
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
    ...noticeGateways,
    members: {
      findRoleRequestMember: async (userId) =>
        findCoverUploader(userId) ?? {
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
    eventCovers: fakeEventCovers().gateway,
    managedSeries: {
      findSeries: async ({ clubId, seriesId }) =>
        (clubId === CLUB_ID ? allSeries.get(seriesId) : undefined) ?? null,
      findSessionDay: async ({ clubId, seriesId, occurrenceId }) => {
        const session = occurrences.get(occurrenceId);
        return clubId === CLUB_ID && session?.seriesId === seriesId
          ? session.startsOn
          : null;
      },
      updateSeries: async ({ seriesId, changes }) => {
        startWrite();
        return applyToOpenOccurrences(store, seriesId, changes);
      },
      splitSeries: async (split) => {
        startWrite();
        return splitStoredSeries(store, split);
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
    occurrencesOf: (seriesId) =>
      [...occurrences.values()]
        .filter((event) => event.seriesId === seriesId)
        .sort((first, second) => first.startsOn.localeCompare(second.startsOn)),
    rsvps,
    writeCount: () => writes,
    notices,
    noticeBatches,
  };
}
