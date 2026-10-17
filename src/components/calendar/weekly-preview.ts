import { SERIES_MAX_DAYS } from "@/lib/events/event-creation";
import {
  ISO_WEEKDAYS,
  type IsoWeekday,
  countRangeDays,
  generateWeeklyOccurrences,
} from "@/lib/events/event-occurrences";
import {
  formatClockRange,
  formatSessionDay,
  formatWeekdays,
} from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { ClubMoment } from "@/lib/time/club-calendar";
import type { EventForm } from "./event-form";

/**
 * Lo que se ve de una serie semanal antes de crearla (#651, RF-10 del PRD de
 * E24): "Every Monday and Thursday, 6:00 pm – 7:30 pm · 18 sessions until
 * Thu, 17 Dec" y las primeras fechas. Las cuenta `generateWeeklyOccurrences`,
 * la misma regla con la que el servidor crea las sesiones, así que lo que se
 * lee es lo que se va a crear. Los códigos `series_weekdays_empty` y
 * `series_without_sessions` del servidor siguen siendo la validación de
 * verdad.
 */

export type WeeklyPreview =
  /** Sin el inicio, el fin o la hora todavía no hay nada que contar. */
  | { readonly kind: "incomplete" }
  | { readonly kind: "noDays" }
  /** Más de lo que el servidor deja durar a una serie. Ni se cuenta: con un
   * año mal escrito serían millones de días. */
  | { readonly kind: "tooLong" }
  | { readonly kind: "noSessions" }
  | {
      readonly kind: "sessions";
      readonly summary: string;
      readonly nextDates: readonly string[];
      /** Las que no caben entre las primeras. */
      readonly moreCount: number;
    };

export type WeeklySeriesInput = Pick<
  EventForm,
  "weekdays" | "startsOn" | "endsOn" | "startTime" | "endTime"
>;

/** Cuántas fechas se enseñan antes del "+n más", como en el diseño. */
const NEXT_DATES_SHOWN = 4;

function describeDays(
  translate: Translator,
  weekdays: readonly IsoWeekday[],
): string {
  if (weekdays.length === ISO_WEEKDAYS.length) {
    return translate("calendar.form.weekly.everyDay");
  }
  return translate("calendar.form.weekly.everyDays", {
    days: formatWeekdays(translate.locale, weekdays, "plural"),
  });
}

type SeriesSessions = {
  readonly weekdays: readonly IsoWeekday[];
  readonly startTime: string;
  readonly endTime: string;
  readonly count: number;
  readonly lastSession: string;
};

function describeSessions(
  translate: Translator,
  series: SeriesSessions,
): string {
  const { locale } = translate;
  const endTime = series.endTime === "" ? null : series.endTime;
  return translate("calendar.form.weekly.summary", {
    days: describeDays(translate, series.weekdays),
    hours: formatClockRange(locale, series.startTime, endTime),
    sessions: translate("calendar.form.weekly.sessions", {
      count: series.count,
    }),
    date: formatSessionDay(locale, series.lastSession),
  });
}

function isIncomplete(series: WeeklySeriesInput): boolean {
  return [series.startsOn, series.endsOn, series.startTime].some(
    (value) => value === "",
  );
}

export function previewWeeklySeries(
  translate: Translator,
  series: WeeklySeriesInput,
  now: ClubMoment,
): WeeklyPreview {
  if (series.weekdays.size === 0) {
    return { kind: "noDays" };
  }
  if (isIncomplete(series)) {
    return { kind: "incomplete" };
  }
  const { startsOn, endsOn, startTime, endTime } = series;
  if (countRangeDays(startsOn, endsOn) > SERIES_MAX_DAYS) {
    return { kind: "tooLong" };
  }
  const weekdays = [...series.weekdays].sort((first, second) => first - second);
  const sessions = generateWeeklyOccurrences(
    { weekdays, startsOn, endsOn, startTime },
    now,
  );
  const lastSession = sessions.at(-1);
  if (lastSession === undefined) {
    return { kind: "noSessions" };
  }
  return {
    kind: "sessions",
    summary: describeSessions(translate, {
      weekdays,
      startTime,
      endTime,
      count: sessions.length,
      lastSession,
    }),
    nextDates: sessions
      .slice(0, NEXT_DATES_SHOWN)
      .map((date) => formatSessionDay(translate.locale, date)),
    moreCount: Math.max(sessions.length - NEXT_DATES_SHOWN, 0),
  };
}
