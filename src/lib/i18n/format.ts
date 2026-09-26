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

// Fecha y hora se formatean por separado y las une la aplicación. Pedirlas
// juntas deja la unión en manos de los datos de idioma de cada Node y cada
// navegador, que no coinciden: unos escriben "15 de septiembre de 2026, 18:00"
// y otros "… a las 18:00". El servidor y el navegador de un socio escribirían
// la misma fecha distinta (#188).
const CLUB_DAY_FORMATTERS = formattersByLocale(
  (displayLocale) =>
    new Intl.DateTimeFormat(displayLocale, {
      dateStyle: "long",
      timeZone: CLUB_TIME_ZONE,
    }),
);

const CLUB_TIME_FORMATTERS = formattersByLocale(
  (displayLocale) =>
    new Intl.DateTimeFormat(displayLocale, {
      timeStyle: "short",
      timeZone: CLUB_TIME_ZONE,
    }),
);

// En español, una coma y no "a las": "a las" falla con la una ("a las 1:00").
const DATE_TIME_JOINERS: Readonly<Record<Locale, string>> = {
  en: " at ",
  es: ", ",
};

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
  const day = CLUB_DAY_FORMATTERS[locale].format(instant);
  const time = CLUB_TIME_FORMATTERS[locale].format(instant);
  return `${day}${DATE_TIME_JOINERS[locale]}${time}`;
}

/** Un día de calendario sin hora (YYYY-MM-DD, como una columna `date`). */
export function formatCalendarDay(locale: Locale, isoDate: string): string {
  return CALENDAR_DAY_FORMATTERS[locale].format(parseCalendarDay(isoDate));
}

const RELATIVE_TIME_FORMATTERS = formattersByLocale(
  (displayLocale) =>
    new Intl.RelativeTimeFormat(displayLocale, { numeric: "auto" }),
);

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;
const SECONDS_PER_WEEK = 7 * SECONDS_PER_DAY;
// Un mes y un año "de calendario" no miden siempre lo mismo. Para decir hace
// cuánto llegó un aviso basta con la aproximación.
const SECONDS_PER_MONTH = 30 * SECONDS_PER_DAY;
const SECONDS_PER_YEAR = 365 * SECONDS_PER_DAY;

/** De la más grande a la más pequeña: se usa la primera que cabe entera en
 * lo que pasó. */
const RELATIVE_TIME_UNITS: readonly {
  readonly unit: Intl.RelativeTimeFormatUnit;
  readonly seconds: number;
}[] = [
  { unit: "year", seconds: SECONDS_PER_YEAR },
  { unit: "month", seconds: SECONDS_PER_MONTH },
  { unit: "week", seconds: SECONDS_PER_WEEK },
  { unit: "day", seconds: SECONDS_PER_DAY },
  { unit: "hour", seconds: SECONDS_PER_HOUR },
  { unit: "minute", seconds: SECONDS_PER_MINUTE },
];

/** Hace cuánto pasó algo ("5 minutes ago", "hace 5 minutos"). Lo de menos de
 * un minuto es "ahora", y también lo que parece futuro: eso sólo pasa cuando
 * el reloj del navegador va por detrás del de la base. */
export function formatRelativeTime(
  locale: Locale,
  instant: Date,
  now: Date,
): string {
  const elapsedSeconds = Math.max(
    0,
    (now.getTime() - instant.getTime()) / 1000,
  );
  const formatter = RELATIVE_TIME_FORMATTERS[locale];
  const largestUnit = RELATIVE_TIME_UNITS.find(
    ({ seconds }) => elapsedSeconds >= seconds,
  );
  if (largestUnit === undefined) {
    return formatter.format(0, "second");
  }
  return formatter.format(
    -Math.floor(elapsedSeconds / largestUnit.seconds),
    largestUnit.unit,
  );
}

const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = 1024 * BYTES_PER_KILOBYTE;
const MEGABYTE_FRACTION_DIGITS = 1;

const FILE_SIZE_FORMATTERS = formattersByLocale(
  (displayLocale) =>
    new Intl.NumberFormat(displayLocale, {
      maximumFractionDigits: MEGABYTE_FRACTION_DIGITS,
    }),
);

/** El tamaño de un archivo ("240 KB", "2,4 MB"). Los símbolos se escriben
 * aquí y no con el estilo `unit` de `Intl`, que en inglés escribe "512 byte"
 * y cambia de un motor a otro, como la fecha y la hora (#188). Sólo el número
 * sigue al idioma. */
export function formatFileSize(locale: Locale, bytes: number): string {
  const formatter = FILE_SIZE_FORMATTERS[locale];
  if (bytes < BYTES_PER_KILOBYTE) {
    return `${formatter.format(bytes)} B`;
  }
  if (bytes < BYTES_PER_MEGABYTE) {
    return `${formatter.format(Math.round(bytes / BYTES_PER_KILOBYTE))} KB`;
  }
  return `${formatter.format(bytes / BYTES_PER_MEGABYTE)} MB`;
}
