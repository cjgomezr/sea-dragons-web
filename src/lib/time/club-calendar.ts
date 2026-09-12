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
