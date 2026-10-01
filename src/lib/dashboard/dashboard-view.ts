import type { ClubMoment } from "@/lib/time/club-calendar";

/**
 * Lo que la pantalla de inicio (#426, RF-1 y RF-4 del PRD de E14) calcula
 * sobre la hora del club. Todo es fecha y hora de pared de Melbourne
 * (NFR-003): quien abre el inicio desde otra zona saluda y cuenta igual que
 * quien lo abre junto a la piscina.
 */

export type GreetingPeriod = "morning" | "afternoon" | "evening";

/** Las horas en punto en que empieza cada franja del saludo. Antes de las
 * cinco de la mañana sigue siendo de noche. */
const MORNING_STARTS_AT_HOUR = 5;
const AFTERNOON_STARTS_AT_HOUR = 12;
const EVENING_STARTS_AT_HOUR = 19;

function hourOf(time: string): number {
  return Number(time.slice(0, 2));
}

export function greetingPeriodAt(moment: ClubMoment): GreetingPeriod {
  const hour = hourOf(moment.time);
  if (hour >= MORNING_STARTS_AT_HOUR && hour < AFTERNOON_STARTS_AT_HOUR) {
    return "morning";
  }
  if (hour >= AFTERNOON_STARTS_AT_HOUR && hour < EVENING_STARTS_AT_HOUR) {
    return "afternoon";
  }
  return "evening";
}

/** "hoy 19:00", "5 h" o "2 d", como en la tesela del mockup. */
export type TimeUntil =
  | { readonly kind: "today"; readonly time: string }
  | { readonly kind: "hours"; readonly hours: number }
  | { readonly kind: "days"; readonly days: number };

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MILLISECONDS_PER_MINUTE = 60 * 1000;

/** Los minutos de pared entre dos momentos del club. Se cuentan como si
 * fueran UTC: en la noche del cambio de horario la cuenta se desvía una
 * hora, y para decir "5 h" en una tesela eso sobra. */
function wallClockMinutesBetween(from: ClubMoment, to: ClubMoment): number {
  const toWallClock = (moment: ClubMoment): number =>
    Date.parse(`${moment.date}T${moment.time}:00.000Z`);
  return (toWallClock(to) - toWallClock(from)) / MILLISECONDS_PER_MINUTE;
}

function calendarDaysBetween(from: string, to: string): number {
  return Math.round(
    wallClockMinutesBetween(
      { date: from, time: "00:00" },
      { date: to, time: "00:00" },
    ) /
      (MINUTES_PER_HOUR * HOURS_PER_DAY),
  );
}

/** Cuánto falta para `start`, que va por delante de `now`. El mismo día del
 * club dice la hora; a menos de 24 horas, las horas que faltan redondeadas
 * hacia arriba; desde ahí, los días de calendario. */
export function timeUntil(start: ClubMoment, now: ClubMoment): TimeUntil {
  if (start.date === now.date) {
    return { kind: "today", time: start.time };
  }
  const hours = Math.ceil(
    wallClockMinutesBetween(now, start) / MINUTES_PER_HOUR,
  );
  if (hours < HOURS_PER_DAY) {
    return { kind: "hours", hours };
  }
  return { kind: "days", days: calendarDaysBetween(now.date, start.date) };
}
