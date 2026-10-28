import { addClubDays } from "@/lib/time/club-calendar";

/**
 * Cuándo empieza un ciclo (#904, D5 del PRD de E35) y a qué semanas pasa la
 * semana 1 al copiarla (RF-8). Son días de calendario de Melbourne
 * (`YYYY-MM-DD`): la aritmética de `addClubDays` no ve el cambio de horario.
 */

const DAYS_PER_WEEK = 7;

/** Lo que fija la semana 1: el evento objetivo o, sin evento, una fecha de
 * inicio cualquiera, que se lleva al lunes de su semana. */
export type CycleSchedule =
  | {
      readonly kind: "event";
      readonly eventName: string;
      /** YYYY-MM-DD. */
      readonly eventDate: string;
    }
  | {
      readonly kind: "start";
      /** YYYY-MM-DD. */
      readonly startDate: string;
    };

/** Las dos últimas semanas (taper y competición) no se copian (RF-8). */
const WEEKS_KEPT_AT_THE_END = 2;
const FIRST_COPY_TARGET = 2;
/** Con menos, no queda ninguna semana entre la 1 y las dos últimas. */
export const MIN_WEEKS_TO_COPY_WEEK_ONE =
  FIRST_COPY_TARGET + WEEKS_KEPT_AT_THE_END;

export class WeekOneCopyTooShortError extends Error {
  constructor() {
    super(
      `Copiar la semana 1 pide un ciclo de al menos ${MIN_WEEKS_TO_COPY_WEEK_ONE} semanas.`,
    );
    this.name = "WeekOneCopyTooShortError";
  }
}

/** El lunes de la semana de `date`: `getUTCDay` da 0 al domingo. */
function mondayOf(date: string): string {
  const sundayFirst = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const daysSinceMonday = (sundayFirst + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK;
  return addClubDays(date, -daysSinceMonday);
}

/** El lunes de la semana 1: con evento, el de la semana del evento menos
 * (N − 1) semanas, para que el evento caiga en la última. */
export function cycleStartDate(schedule: CycleSchedule, weeks: number): string {
  if (schedule.kind === "start") {
    return mondayOf(schedule.startDate);
  }
  return addClubDays(
    mondayOf(schedule.eventDate),
    -(weeks - 1) * DAYS_PER_WEEK,
  );
}

/** De la semana 2 a la N − 2. */
export function weekOneCopyTargets(weeks: number): readonly number[] {
  if (weeks < MIN_WEEKS_TO_COPY_WEEK_ONE) {
    throw new WeekOneCopyTooShortError();
  }
  const lastTarget = weeks - WEEKS_KEPT_AT_THE_END;
  return Array.from(
    { length: lastTarget - FIRST_COPY_TARGET + 1 },
    (_, index) => FIRST_COPY_TARGET + index,
  );
}
