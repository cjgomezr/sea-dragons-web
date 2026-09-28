import { formatCalendarDayParts } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { clubCalendarDate } from "@/lib/time/club-calendar";

/**
 * El día de una sesión tal como lo escribe la pantalla de Asistencia (#395):
 * "Tue 23 Jun" en el título y "Tue 23" en su ficha. El día es el de
 * Melbourne (NFR-003), sea cual sea la zona de quien mira, y va sin el cero
 * delante que lleva el bloque de fecha de la agenda.
 */

export type SessionDay = {
  readonly weekday: string;
  readonly day: string;
  readonly month: string;
};

export function sessionDay(locale: Locale, startsAt: string): SessionDay {
  const parts = formatCalendarDayParts(
    locale,
    clubCalendarDate(new Date(startsAt)),
  );
  return { ...parts, day: String(Number(parts.day)) };
}
