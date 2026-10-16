/** El club opera en Melbourne (NFR-003) y cruza dos veces al año el cambio de
 * horario de verano. Cualquier regla que hable de "hoy" tiene que resolverse
 * en esta zona: en UTC, el día del club empieza 10 u 11 horas antes. */
export const CLUB_TIME_ZONE = "Australia/Melbourne";

// "en-CA" formatea como YYYY-MM-DD, que es el mismo formato de una columna
// `date` de Postgres y ordena bien comparándolo como texto.
const CLUB_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: CLUB_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Día de calendario del club (YYYY-MM-DD) en el que cae `instant`. */
export function clubCalendarDate(instant: Date): string {
  return CLUB_DATE_FORMATTER.format(instant);
}

/** Una fecha y una hora de pared de Melbourne, como las escribe quien crea un
 * evento: `YYYY-MM-DD` y `HH:MM`. Comparadas como texto ordenan igual que los
 * instantes que nombran, salvo dentro de la hora que se repite al terminar el
 * horario de verano, y a esa escala sobra para decir si algo ya pasó. */
export type ClubMoment = { readonly date: string; readonly time: string };

// `h23` y no `hour12: false`: con este último, la medianoche sale como "24".
const CLUB_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: CLUB_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** La fecha y la hora de Melbourne en las que cae `instant`. */
export function clubMoment(instant: Date): ClubMoment {
  return {
    date: clubCalendarDate(instant),
    time: CLUB_TIME_FORMATTER.format(instant),
  };
}

const ISO_DATE_LENGTH = "YYYY-MM-DD".length;
const ISO_YEAR_LENGTH = "YYYY".length;

/** El año (YYYY) de un día de calendario (YYYY-MM-DD). */
export function calendarYearOf(date: string): string {
  return date.slice(0, ISO_YEAR_LENGTH);
}

/** El día del club `days` días antes de `date` (YYYY-MM-DD). Se cuenta en UTC
 * a propósito: es aritmética de calendario, y ahí no hay cambio de horario
 * que pueda comerse o duplicar un día. */
export function subtractClubDays(date: string, days: number): string {
  return addClubDays(date, -days);
}

/** El día del club `days` días después de `date` (YYYY-MM-DD), con la misma
 * aritmética de calendario que `subtractClubDays`. */
export function addClubDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, ISO_DATE_LENGTH);
}

const CLUB_WALL_CLOCK_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: CLUB_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Cuánto va Melbourne por delante de UTC en `instant`, en milisegundos. */
function clubOffsetAt(instant: Date): number {
  const parts = Object.fromEntries(
    CLUB_WALL_CLOCK_FORMATTER.formatToParts(instant).map((part) => [
      part.type,
      part.value,
    ]),
  );
  const wallClockAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
  );
  return wallClockAsUtc - Math.floor(instant.getTime() / 60_000) * 60_000;
}

/** El instante en que el reloj de Melbourne marca `moment`, con el horario
 * de verano que rija ese día. El desfase se mide dos veces porque el de la
 * primera estimación puede ser el del otro lado del cambio de hora. */
export function clubInstant(moment: ClubMoment): Date {
  const wallClockAsUtc = new Date(`${moment.date}T${moment.time}:00Z`);
  const firstGuess = wallClockAsUtc.getTime() - clubOffsetAt(wallClockAsUtc);
  const offset = clubOffsetAt(new Date(firstGuess));
  return new Date(wallClockAsUtc.getTime() - offset);
}
