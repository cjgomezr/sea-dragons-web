import type { IsoWeekday } from "@/lib/events/event-occurrences";
import { CLUB_TIME_ZONE, clubCalendarDate } from "@/lib/time/club-calendar";
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

const CLUB_SHORT_DAY_FORMATTERS = formattersByLocale(
  (displayLocale) =>
    new Intl.DateTimeFormat(displayLocale, {
      day: "numeric",
      month: "short",
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

/** El OVR siempre a un decimal (FR-052): "5.0" y no "5", para que una media
 * entera no parezca una nota puesta a mano. */
const OVERALL_RATING_FORMATTERS = formattersByLocale(
  (displayLocale) =>
    new Intl.NumberFormat(displayLocale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }),
);

export function formatOverallRating(locale: Locale, value: number): string {
  return OVERALL_RATING_FORMATTERS[locale].format(value);
}

/** Un porcentaje entero, 0 a 100, como lo sirve la asistencia (#394). El
 * símbolo va pegado en inglés y separado en español, con un espacio que no
 * se parte: lo decide el idioma, no la pantalla. */
const PERCENT_FORMATTERS = formattersByLocale(
  (displayLocale) =>
    new Intl.NumberFormat(displayLocale, {
      style: "percent",
      maximumFractionDigits: 0,
    }),
);

export function formatPercent(locale: Locale, percent: number): string {
  return PERCENT_FORMATTERS[locale].format(percent / 100);
}

/** Los importes del club son en AUD (FR-062) y se guardan en centavos enteros
 * (CON-005); sólo al pintarlos se convierten a unidades. */
const AUD_FORMATTERS = formattersByLocale(
  (displayLocale) =>
    new Intl.NumberFormat(displayLocale, {
      style: "currency",
      currency: "AUD",
    }),
);

const CENTS_PER_DOLLAR = 100;

export function formatAudCents(locale: Locale, cents: number): string {
  return AUD_FORMATTERS[locale].format(cents / CENTS_PER_DOLLAR);
}

/** Un instante del club (un entrenamiento, una solicitud), con fecha y hora de
 * Melbourne sea cual sea el idioma o la zona de quien lo mira. */
export function formatClubMoment(locale: Locale, instant: Date): string {
  const day = CLUB_DAY_FORMATTERS[locale].format(instant);
  const time = CLUB_TIME_FORMATTERS[locale].format(instant);
  return `${day}${DATE_TIME_JOINERS[locale]}${time}`;
}

/** El día del club en que pasó algo, sin la hora: la fecha de una tarjeta
 * de solicitud en el móvil (#553). */
export function formatClubDay(locale: Locale, instant: Date): string {
  return CLUB_DAY_FORMATTERS[locale].format(instant);
}

/** El día del club en corto, sin el año ("30 Oct", "30 oct"): hasta cuándo
 * está fijada una publicación (#594). */
export function formatClubShortDay(locale: Locale, instant: Date): string {
  return CLUB_SHORT_DAY_FORMATTERS[locale].format(instant);
}

/** Un día de calendario sin hora (YYYY-MM-DD, como una columna `date`). */
export function formatCalendarDay(locale: Locale, isoDate: string): string {
  return CALENDAR_DAY_FORMATTERS[locale].format(parseCalendarDay(isoDate));
}

const CALENDAR_MONTH_FORMATTERS = formattersByLocale(
  (displayLocale) =>
    new Intl.DateTimeFormat(displayLocale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
);

/** Un mes de calendario (YYYY-MM) con su año: "October 2026", "octubre de
 * 2026". El título de cada grupo del historial de pagos (#631). */
export function formatCalendarMonth(locale: Locale, isoMonth: string): string {
  return CALENDAR_MONTH_FORMATTERS[locale].format(
    parseCalendarDay(`${isoMonth}-01`),
  );
}

/** Las tres líneas del bloque de fecha de una fila de la agenda (#311). */
export type CalendarDayParts = {
  readonly weekday: string;
  readonly day: string;
  readonly month: string;
};

function calendarDayPartFormatters(
  options: Intl.DateTimeFormatOptions,
): Readonly<Record<Locale, Intl.DateTimeFormat>> {
  return formattersByLocale(
    (displayLocale) =>
      new Intl.DateTimeFormat(displayLocale, { ...options, timeZone: "UTC" }),
  );
}

const SHORT_WEEKDAY_FORMATTERS = calendarDayPartFormatters({
  weekday: "short",
});
const TWO_DIGIT_DAY_FORMATTERS = calendarDayPartFormatters({ day: "2-digit" });
const SHORT_MONTH_FORMATTERS = calendarDayPartFormatters({ month: "short" });

/** El bloque de fecha del mockup lleva el mes en tres letras ("JUN"). El mes
 * corto de `Intl` no lo garantiza: en inglés australiano, según la versión de
 * ICU, junio sale como "Jun" o "June" y septiembre como "Sep" o "Sept", y
 * la máquina de quien desarrolla y la de CI no siempre coinciden. Se recorta
 * para que el bloque sea el mismo en todas. */
const MONTH_ABBREVIATION_LENGTH = 3;

/** Un día sin hora partido en "Tue", "23" y "Jun" ("mar", "23", "jun"). */
export function formatCalendarDayParts(
  locale: Locale,
  isoDate: string,
): CalendarDayParts {
  const midnightUtc = parseCalendarDay(isoDate);
  return {
    weekday: SHORT_WEEKDAY_FORMATTERS[locale].format(midnightUtc),
    day: TWO_DIGIT_DAY_FORMATTERS[locale].format(midnightUtc),
    month: [...SHORT_MONTH_FORMATTERS[locale].format(midnightUtc)]
      .slice(0, MONTH_ABBREVIATION_LENGTH)
      .join(""),
  };
}

const AGENDA_DAY_SEPARATOR = " · ";

/** La etiqueta de un día de la agenda (#647): "SAT · OCT 17", y en español
 * con el día delante, "SÁB · 17 OCT". Con `withYear`, el año al final, para
 * un día de otro año. */
export function formatAgendaDayLabel(
  locale: Locale,
  isoDate: string,
  { withYear }: { readonly withYear: boolean },
): string {
  const { weekday, day, month } = formatCalendarDayParts(locale, isoDate);
  const dayNumber = String(Number(day));
  const date =
    locale === "es" ? `${dayNumber} ${month}` : `${month} ${dayNumber}`;
  const parts = [weekday, date, ...(withYear ? [isoDate.slice(0, 4)] : [])];
  return parts
    .join(AGENDA_DAY_SEPARATOR)
    .toLocaleUpperCase(DISPLAY_LOCALES[locale]);
}

const CALENDAR_DAY_WITH_WEEKDAY_FORMATTERS = calendarDayPartFormatters({
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** Un día sin hora con su día de la semana: "Saturday 17 October 2026",
 * "sábado, 17 de octubre de 2026". */
export function formatCalendarDayWithWeekday(
  locale: Locale,
  isoDate: string,
): string {
  return CALENDAR_DAY_WITH_WEEKDAY_FORMATTERS[locale].format(
    parseCalendarDay(isoDate),
  );
}

/** El día del club en que pasó algo, en corto y con el mes recortado igual
 * que el bloque de la agenda ("1 Oct", "18 sep"): la fecha de una fila del
 * historial de pagos (#631), que no puede cambiar de ancho según el ICU. */
export function formatClubCompactDay(locale: Locale, instant: Date): string {
  const { day, month } = formatCalendarDayParts(
    locale,
    clubCalendarDate(instant),
  );
  return `${Number(day)} ${month}`;
}

// Una hora de reloj sin día, como el `HH:MM` de un evento, se formatea igual
// que un día sin hora: en UTC, sobre el 1 de enero de 1970.
const CLOCK_TIME_FORMATTERS = formattersByLocale(
  (displayLocale) =>
    new Intl.DateTimeFormat(displayLocale, {
      timeStyle: "short",
      timeZone: "UTC",
    }),
);

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function formatClockTime(locale: Locale, clockTime: string): string {
  if (!CLOCK_TIME.test(clockTime)) {
    throw new RangeError(`"${clockTime}" no es una hora en formato HH:MM.`);
  }
  return CLOCK_TIME_FORMATTERS[locale].format(
    new Date(`1970-01-01T${clockTime}:00Z`),
  );
}

/** Un día y una hora de reloj de Melbourne guardados por separado, como los
 * de un evento: se escriben tal cual, sin pasar por ningún instante. */
export function formatCalendarDayAt(
  locale: Locale,
  isoDate: string,
  clockTime: string,
): string {
  const day = formatCalendarDay(locale, isoDate);
  return `${day}${DATE_TIME_JOINERS[locale]}${formatClockTime(locale, clockTime)}`;
}

/** Entre el inicio y el fin de un evento, con un espacio a cada lado, igual
 * en los dos idiomas ("6:00 pm – 7:30 pm"). */
const RANGE_SEPARATOR = " – ";

/** La hora de inicio y, si la hay, la de fin, de una sesión de un día:
 * "6:00 pm – 7:30 pm". Sin hora de fin (lo anterior a E24), sólo el inicio. */
export function formatClockRange(
  locale: Locale,
  startTime: string,
  endTime: string | null,
): string {
  const start = formatClockTime(locale, startTime);
  return endTime === null
    ? start
    : `${start}${RANGE_SEPARATOR}${formatClockTime(locale, endTime)}`;
}

/** Cuándo empieza y termina un evento, con su día y su hora de Melbourne.
 * El de varios días repite el día al final; el de uno, sólo la hora. */
export function formatEventSpan(
  locale: Locale,
  span: {
    readonly startsOn: string;
    readonly startTime: string;
    readonly endsOn: string | null;
    readonly endTime: string | null;
  },
): string {
  if (span.endTime === null || span.endsOn === null) {
    const day = formatCalendarDay(locale, span.startsOn);
    const times = formatClockRange(locale, span.startTime, span.endTime);
    return `${day}${DATE_TIME_JOINERS[locale]}${times}`;
  }
  const start = formatCalendarDayAt(locale, span.startsOn, span.startTime);
  const end = formatCalendarDayAt(locale, span.endsOn, span.endTime);
  return `${start}${RANGE_SEPARATOR}${end}`;
}

const WEEKDAY_FORMATTERS = formattersByLocale(
  (displayLocale) =>
    new Intl.DateTimeFormat(displayLocale, {
      weekday: "long",
      timeZone: "UTC",
    }),
);

const WEEKDAY_LIST_FORMATTERS = formattersByLocale(
  (displayLocale) =>
    new Intl.ListFormat(displayLocale, { type: "conjunction" }),
);

/** El 1 de enero de 2024 fue lunes: el día ISO `n` es `n - 1` días después. */
const A_MONDAY = "2024-01-01";
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function dayOfWeek(weekday: IsoWeekday): Date {
  const monday = parseCalendarDay(A_MONDAY).getTime();
  return new Date(monday + (weekday - 1) * MILLISECONDS_PER_DAY);
}

/** El nombre de un día de la semana, entero ("Tuesday") o corto ("Tue"),
 * como los que se marcan al crear una serie (#313). */
export function formatWeekdayName(
  locale: Locale,
  weekday: IsoWeekday,
  width: "long" | "short",
): string {
  const formatters =
    width === "long" ? WEEKDAY_FORMATTERS : SHORT_WEEKDAY_FORMATTERS;
  return formatters[locale].format(dayOfWeek(weekday));
}

/** Los días de una serie semanal ("Tuesday and Thursday", "martes y
 * jueves"), en el orden en que llegan. */
export function formatWeekdays(
  locale: Locale,
  weekdays: readonly IsoWeekday[],
): string {
  const names = weekdays.map((weekday) =>
    formatWeekdayName(locale, weekday, "long"),
  );
  return WEEKDAY_LIST_FORMATTERS[locale].format(names);
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
