import {
  addClubDays,
  clubCalendarDate,
  clubDaysBetween,
} from "@/lib/time/club-calendar";

/**
 * En qué semana de un ciclo cae un instante (#898, D5 del PRD de E35), con el
 * día de Melbourne (NFR-003). Antes del inicio se mira la semana 1, y después
 * del fin la última, diciendo en qué lado se está.
 */

const DAYS_PER_WEEK = 7;
const FIRST_WEEK = 1;

/** Lo justo de un ciclo para situar un día: su lunes de inicio y cuántas
 * semanas dura. */
export type CycleSpan = {
  /** YYYY-MM-DD, un lunes. */
  readonly startDate: string;
  readonly weeks: number;
};

export type CyclePhase = "not_started" | "running" | "finished";

export type CycleWeekPosition = {
  readonly week: number;
  readonly phase: CyclePhase;
  /** El día de Melbourne en que cae el instante (YYYY-MM-DD). */
  readonly today: string;
};

/** El domingo de la última semana (YYYY-MM-DD). */
export function cycleEndDate(cycle: CycleSpan): string {
  return addClubDays(cycle.startDate, cycle.weeks * DAYS_PER_WEEK - 1);
}

/** El día de la semana `week` que cae en `weekday` (0 es el lunes). */
export function cycleDayDate(
  cycle: CycleSpan,
  day: { readonly week: number; readonly weekday: number },
): string {
  return addClubDays(
    cycle.startDate,
    (day.week - FIRST_WEEK) * DAYS_PER_WEEK + day.weekday,
  );
}

export function cycleWeekAt(cycle: CycleSpan, now: Date): CycleWeekPosition {
  const today = clubCalendarDate(now);
  const daysSinceStart = clubDaysBetween(cycle.startDate, today);
  if (daysSinceStart < 0) {
    return { week: FIRST_WEEK, phase: "not_started", today };
  }
  const week = Math.floor(daysSinceStart / DAYS_PER_WEEK) + FIRST_WEEK;
  if (week > cycle.weeks) {
    return { week: cycle.weeks, phase: "finished", today };
  }
  return { week, phase: "running", today };
}
