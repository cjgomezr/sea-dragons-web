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

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MILLISECONDS_PER_MINUTE = 60 * 1000;

/** Los minutos de pared entre dos momentos del club. Se cuentan como si
 * fueran UTC: en la noche del cambio de horario la cuenta se desvía una
 * hora, y para contar días de calendario eso no cambia nada. */
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

/** Lo que dice la píldora de la tarjeta "Próximo" (#747, RF-3 del PRD de
 * E27): "hoy", "mañana" o "en N días". */
export type NextUpDistance =
  | { readonly kind: "today" }
  | { readonly kind: "tomorrow" }
  | { readonly kind: "days"; readonly days: number };

/** Los días de calendario del club de `today` a `startsOn`. Un evento que ya
 * empezó y sigue en curso (D4) es de hoy. */
export function nextUpDistance(
  startsOn: string,
  today: string,
): NextUpDistance {
  const days = calendarDaysBetween(today, startsOn);
  if (days <= 0) {
    return { kind: "today" };
  }
  return days === 1 ? { kind: "tomorrow" } : { kind: "days", days };
}

/** La primera palabra del nombre completo: el saludo dice "Alba", no
 * "Alba Ferrer". */
export function firstNameOf(fullName: string): string {
  const [firstName = fullName] = fullName.trim().split(/\s+/);
  return firstName;
}
