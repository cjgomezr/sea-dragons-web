import { CLUB_TIME_ZONE } from "@/lib/time/club-calendar";
import type { Locale } from "./locale";

/** Las variantes con las que se escriben fechas y números. El inglés es el
 * australiano porque el club es de Melbourne: un socio espera "2 March 1994",
 * no "March 2, 1994". Solo afecta a lo que se muestra; lo que se guarda o se
 * compara sigue en YYYY-MM-DD (`clubCalendarDate`). */
const DISPLAY_LOCALES: Readonly<Record<Locale, string>> = {
  en: "en-AU",
  es: "es",
};

function formattersByLocale<Formatter>(
  create: (displayLocale: string) => Formatter,
): Readonly<Record<Locale, Formatter>> {
  return { en: create(DISPLAY_LOCALES.en), es: create(DISPLAY_LOCALES.es) };
}

const NUMBER_FORMATTERS = formattersByLocale(
  (displayLocale) => new Intl.NumberFormat(displayLocale),
);

const CLUB_MOMENT_FORMATTERS = formattersByLocale(
  (displayLocale) =>
    new Intl.DateTimeFormat(displayLocale, {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: CLUB_TIME_ZONE,
    }),
);

// Un día sin hora no pertenece a ninguna zona. Se formatea en UTC sobre la
// medianoche UTC de ese día, así ninguna zona lo arrastra al día de al lado.
const CALENDAR_DAY_FORMATTERS = formattersByLocale(
  (displayLocale) =>
    new Intl.DateTimeFormat(displayLocale, {
      dateStyle: "long",
      timeZone: "UTC",
    }),
);

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseCalendarDay(isoDate: string): Date {
  const match = CALENDAR_DAY.exec(isoDate);
  if (match === null) {
    throw new RangeError(`"${isoDate}" no es un día en formato YYYY-MM-DD.`);
  }
  const [, year, month, day] = match;
  const midnightUtc = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );
  // `Date.UTC` desborda en silencio: el 30 de febrero pasa a ser el 2 de marzo.
  if (midnightUtc.toISOString().slice(0, isoDate.length) !== isoDate) {
    throw new RangeError(`"${isoDate}" no es un día del calendario.`);
  }
  return midnightUtc;
}

export function formatNumber(locale: Locale, value: number): string {
  return NUMBER_FORMATTERS[locale].format(value);
}

/** Un instante del club (un entrenamiento, una solicitud), con fecha y hora de
 * Melbourne sea cual sea el idioma o la zona de quien lo mira. */
export function formatClubMoment(locale: Locale, instant: Date): string {
  return CLUB_MOMENT_FORMATTERS[locale].format(instant);
}

/** Un día de calendario sin hora (YYYY-MM-DD, como una columna `date`). */
export function formatCalendarDay(locale: Locale, isoDate: string): string {
  return CALENDAR_DAY_FORMATTERS[locale].format(parseCalendarDay(isoDate));
}
