import type { EventType } from "@/lib/events/event-creation";
import { addClubDays } from "@/lib/time/club-calendar";
import type { WeekEvent } from "./dashboard-events";

/**
 * "Esta semana" del inicio (#748, RF-4 y D14 del PRD de E27): los eventos de
 * `week` repartidos en los días de hoy a hoy + 6. Un evento de varios días
 * cuenta en cada día que ocupa dentro de la franja, también el que empezó
 * antes de hoy. Todo son días del club (`YYYY-MM-DD`), como el calendario.
 */

/** La franja de la semana: hoy y los seis días siguientes (D14). */
export const DASHBOARD_WEEK_DAYS = 7;

/** Los puntos de un día: uno por tipo presente, hasta tres (D14). */
export const MAX_DAY_DOTS = 3;

export type WeekDay = {
  readonly date: string;
  /** Los que ocupan el día, en el orden en que llegan de `week`. */
  readonly events: readonly WeekEvent[];
  /** Los tipos presentes, sin repetir y en el orden de sus eventos. */
  readonly eventTypes: readonly EventType[];
};

function occupiesDay(event: WeekEvent, date: string): boolean {
  return event.startsOn <= date && (event.endsOn ?? event.startsOn) >= date;
}

function dotTypesOf(events: readonly WeekEvent[]): readonly EventType[] {
  const types = [...new Set(events.map((event) => event.eventType))];
  return types.slice(0, MAX_DAY_DOTS);
}

export function spreadWeekByDay(
  events: readonly WeekEvent[],
  today: string,
): readonly WeekDay[] {
  return Array.from({ length: DASHBOARD_WEEK_DAYS }, (_, offset) => {
    const date = addClubDays(today, offset);
    const dayEvents = events.filter((event) => occupiesDay(event, date));
    return { date, events: dayEvents, eventTypes: dotTypesOf(dayEvents) };
  });
}

/** El día del Próximo si cae en la franja; si no, hoy (D14). */
export function pickDefaultWeekDay(
  days: readonly WeekDay[],
  nextUpStartsOn: string | null,
): string {
  const [today] = days;
  if (today === undefined) {
    throw new RangeError("La semana del inicio no tiene días.");
  }
  const nextUpDay = days.find((day) => day.date === nextUpStartsOn);
  return (nextUpDay ?? today).date;
}
