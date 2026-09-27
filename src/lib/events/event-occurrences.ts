import type { ClubMoment } from "@/lib/time/club-calendar";

/**
 * Las fechas de una serie semanal (#307, RF-3 del PRD de E7).
 *
 * Se cuenta en días de calendario, nunca en instantes: la hora la combina la
 * base con cada fecha en la zona del club (`events.starts_at`), así que la
 * sesión de las 19:00 sigue a las 19:00 al cruzar un cambio de horario. Por
 * eso las fechas se recorren en UTC, que no tiene horario de verano y no
 * puede saltarse ni repetir un día.
 */

/** Del 1 (lunes) al 7 (domingo), ISO 8601, como `extract(isodow ...)` y la
 * columna `event_series.weekdays`. */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export type IsoWeekday = (typeof ISO_WEEKDAYS)[number];

export type WeeklyRecurrence = {
  readonly weekdays: readonly IsoWeekday[];
  /** `YYYY-MM-DD`, los dos incluidos. */
  readonly startsOn: string;
  readonly endsOn: string;
  /** `HH:MM` de Melbourne. */
  readonly startTime: string;
};

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const SUNDAY_IN_JAVASCRIPT = 0;
const SUNDAY_IN_ISO: IsoWeekday = 7;

function toUtcDay(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function toIsoDate(day: Date): string {
  return day.toISOString().slice(0, 10);
}

function isoWeekdayOf(day: Date): number {
  const weekday = day.getUTCDay();
  return weekday === SUNDAY_IN_JAVASCRIPT ? SUNDAY_IN_ISO : weekday;
}

/** Cuántos días hay del inicio al fin, los dos incluidos. Cero o menos si el
 * fin va antes. */
export function countRangeDays(startsOn: string, endsOn: string): number {
  const span = toUtcDay(endsOn).getTime() - toUtcDay(startsOn).getTime();
  return Math.round(span / MILLISECONDS_PER_DAY) + 1;
}

/** Si una sesión de esa fecha y esa hora todavía no empezó. La que empieza
 * justo ahora ya no cuenta como futura. */
export function isStillAhead(
  session: { readonly date: string; readonly time: string },
  now: ClubMoment,
): boolean {
  return (
    session.date > now.date ||
    (session.date === now.date && session.time > now.time)
  );
}

/** Cada fecha del rango que cae en uno de los días elegidos, en orden, sin
 * las que ya empezaron: la de hoy sólo sale si su hora todavía no llegó. */
export function generateWeeklyOccurrences(
  recurrence: WeeklyRecurrence,
  now: ClubMoment,
): readonly string[] {
  const weekdays = new Set<number>(recurrence.weekdays);
  const first = toUtcDay(recurrence.startsOn).getTime();
  const dayCount = countRangeDays(recurrence.startsOn, recurrence.endsOn);
  return Array.from(
    { length: Math.max(dayCount, 0) },
    (_unused, offset) => new Date(first + offset * MILLISECONDS_PER_DAY),
  )
    .filter((day) => weekdays.has(isoWeekdayOf(day)))
    .map(toIsoDate)
    .filter((date) => isStillAhead({ date, time: recurrence.startTime }, now));
}
