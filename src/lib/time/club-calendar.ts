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
