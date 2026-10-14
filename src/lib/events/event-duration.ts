import type { Locale } from "@/lib/i18n/locale";
import { clubInstant } from "@/lib/time/club-calendar";
import { countRangeDays } from "./event-occurrences";

/**
 * Cuánto dura un evento, como se le enseña a quien lo mira (#642, RF-2 del
 * PRD de E24): "1 h 30 min" en el panel y en el formulario, "2 days" en uno
 * de varios días.
 *
 * Las horas son las reales de Melbourne (`CLUB_TIME_ZONE`): de 1:00 a 4:00 el
 * día que empieza el horario de verano son dos horas, no tres. Lo que dura un
 * día o más se cuenta en días de calendario, los dos extremos incluidos, que
 * es como lo dice el diseño ("8:30 am Sat – 5 pm Sun · 2 days").
 */

/** Un evento con su hora de fin. `endsOn` es nulo si termina el mismo día. */
export type EventSpan = {
  readonly startsOn: string;
  readonly startTime: string;
  readonly endsOn: string | null;
  readonly endTime: string;
};

const MILLISECONDS_PER_MINUTE = 60 * 1000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

const DAY_UNITS: Readonly<Record<Locale, string>> = {
  en: "days",
  es: "días",
};

function lengthInMinutes(span: EventSpan): number {
  const start = clubInstant({ date: span.startsOn, time: span.startTime });
  const end = clubInstant({
    date: span.endsOn ?? span.startsOn,
    time: span.endTime,
  });
  return Math.round(
    (end.getTime() - start.getTime()) / MILLISECONDS_PER_MINUTE,
  );
}

function describeHoursAndMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

export function describeEventDuration(locale: Locale, span: EventSpan): string {
  const totalMinutes = lengthInMinutes(span);
  if (span.endsOn === null || totalMinutes < MINUTES_PER_DAY) {
    return describeHoursAndMinutes(totalMinutes);
  }
  const days = countRangeDays(span.startsOn, span.endsOn);
  return `${days} ${DAY_UNITS[locale]}`;
}
