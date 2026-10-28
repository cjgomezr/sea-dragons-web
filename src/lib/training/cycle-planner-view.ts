import type { CycleInput, CycleStatus, ManagedCycle } from "./club-cycles";
import type { CycleSchedule } from "./cycle-schedule";
import { cycleDayDate, cycleEndDate, cycleWeekAt } from "./cycle-week";

/**
 * Lo que Planificar → Ciclo (#906, RF-7 y D5 del PRD de E35) calcula de los
 * ciclos antes de pintarlos: en qué orden van, cuál se abre, qué dice la
 * línea calculada y qué calendario se manda al cambiar el evento o su fecha.
 */

const STATUS_ORDER: Readonly<Record<CycleStatus, number>> = {
  active: 0,
  draft: 1,
  archived: 2,
};

/** Lo que nace al pulsar + New cycle: un borrador que se renombra después. */
export const NEW_CYCLE_WEEKS = 8;

/** El activo, luego los borradores y al final los archivados; dentro de cada
 * estado, en el orden en que llegan. */
export function sortCycles(
  cycles: readonly ManagedCycle[],
): readonly ManagedCycle[] {
  return [...cycles].sort(
    (first, second) => STATUS_ORDER[first.status] - STATUS_ORDER[second.status],
  );
}

/** Se abre el activo; sin él, el primer borrador; sin borradores, el primero
 * que haya. Nulo sin ciclos. */
export function defaultCycleId(cycles: readonly ManagedCycle[]): string | null {
  return sortCycles(cycles).at(0)?.id ?? null;
}

/** La línea bajo los campos, según el estado del ciclo. */
export type CycleSummary =
  | {
      readonly kind: "active";
      readonly startDate: string;
      /** La semana del evento, que es la última; nula sin evento. */
      readonly eventWeek: number | null;
      readonly endDate: string;
      /** En qué semana están hoy los miembros, entre 1 y la última. */
      readonly currentWeek: number;
    }
  | { readonly kind: "draft"; readonly startDate: string }
  | {
      readonly kind: "archived";
      readonly startDate: string;
      readonly endDate: string;
    };

export function summarizeCycle(cycle: ManagedCycle, now: Date): CycleSummary {
  switch (cycle.status) {
    case "active":
      return {
        kind: "active",
        startDate: cycle.startDate,
        eventWeek: cycle.event === null ? null : cycle.weeks,
        endDate: cycleEndDate(cycle),
        currentWeek: cycleWeekAt(cycle, now).week,
      };
    case "draft":
      return { kind: "draft", startDate: cycle.startDate };
    case "archived":
      return {
        kind: "archived",
        startDate: cycle.startDate,
        endDate: cycleEndDate(cycle),
      };
  }
}

/** El calendario al cambiar el evento sin mover el ciclo: quitarlo deja la
 * semana 1 donde estaba, y ponerlo a un ciclo sin él lo pone el lunes de la
 * última semana. Nulo si nada cambia. */
export function scheduleForEventName(
  cycle: ManagedCycle,
  rawEventName: string,
): CycleSchedule | null {
  const eventName = rawEventName.trim();
  if (eventName === (cycle.event?.name ?? "")) {
    return null;
  }
  if (eventName === "") {
    return { kind: "start", startDate: cycle.startDate };
  }
  return {
    kind: "event",
    eventName,
    eventDate:
      cycle.event?.date ??
      cycleDayDate(cycle, { week: cycle.weeks, weekday: 0 }),
  };
}

/** La fecha del campo: la del evento si lo hay, la de inicio si no. */
export function scheduleDate(cycle: ManagedCycle): string {
  return cycle.event?.date ?? cycle.startDate;
}

/** El calendario al cambiar la fecha del campo. Nulo si nada cambia. */
export function scheduleForDate(
  cycle: ManagedCycle,
  date: string,
): CycleSchedule | null {
  if (date === scheduleDate(cycle)) {
    return null;
  }
  return cycle.event === null
    ? { kind: "start", startDate: date }
    : { kind: "event", eventName: cycle.event.name, eventDate: date };
}

/** El borrador de + New cycle, que empieza la semana de `today`. */
export function newCycleInput(name: string, today: string): CycleInput {
  return {
    name,
    weeks: NEW_CYCLE_WEEKS,
    schedule: { kind: "start", startDate: today },
  };
}
