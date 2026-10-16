import type { EventSeriesSummary } from "@/lib/events/event-agenda";
import { describeEventDuration } from "@/lib/events/event-duration";
import {
  formatCalendarDayParts,
  formatClockRange,
  formatClockTime,
  formatPanelDay,
  formatPanelShortDay,
  formatShortMonthDay,
  formatWeekdays,
} from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Lo que dicen los bloques de hora y de repetición del panel del evento
 * (#648, RF-7 del PRD de E24): "Wednesday, October 14" con "6:00 pm –
 * 7:30 pm · 1 h 30 min", o "Every Wednesday" con "Until Dec 16 · 10 sessions
 * left".
 */

/** Las dos líneas de un bloque del panel. */
export type PanelWhen = { readonly day: string; readonly hours: string };

export type PanelRepeat = { readonly days: string; readonly until: string };

/** Entre los dos extremos y antes de lo que dura, igual en los dos idiomas. */
const RANGE_SEPARATOR = " – ";
const DURATION_SEPARATOR = " · ";

type WhenSpan = {
  readonly startsOn: string;
  readonly startTime: string;
  readonly endsOn: string | null;
  /** Nula en lo anterior a E24: sólo se sabe el inicio. */
  readonly endTime: string | null;
};

/** "8:30 am Sat": la hora con el día corto detrás. */
function clockWithWeekday(
  translate: Translator,
  isoDate: string,
  clockTime: string,
): string {
  const { locale } = translate;
  const { weekday } = formatCalendarDayParts(locale, isoDate);
  return `${formatClockTime(locale, clockTime)} ${weekday}`;
}

export function describeEventWhen(
  translate: Translator,
  span: WhenSpan,
): PanelWhen {
  const { locale } = translate;
  const { startsOn, startTime, endsOn, endTime } = span;
  if (endTime === null) {
    return {
      day: formatPanelDay(locale, startsOn),
      hours: formatClockTime(locale, startTime),
    };
  }
  const duration = describeEventDuration(locale, { ...span, endTime });
  if (endsOn === null) {
    return {
      day: formatPanelDay(locale, startsOn),
      hours: `${formatClockRange(locale, startTime, endTime)}${DURATION_SEPARATOR}${duration}`,
    };
  }
  const start = clockWithWeekday(translate, startsOn, startTime);
  const end = clockWithWeekday(translate, endsOn, endTime);
  return {
    day: `${formatPanelShortDay(locale, startsOn)}${RANGE_SEPARATOR}${formatPanelShortDay(locale, endsOn)}`,
    hours: `${start}${RANGE_SEPARATOR}${end}${DURATION_SEPARATOR}${duration}`,
  };
}

export function describeSeriesRepeat(
  translate: Translator,
  series: EventSeriesSummary,
): PanelRepeat {
  const { locale } = translate;
  return {
    days: translate("calendar.panel.repeat.every", {
      days: formatWeekdays(locale, series.weekdays, "plural"),
    }),
    until: translate("calendar.panel.repeat.until", {
      date: formatShortMonthDay(locale, series.endsOn),
      sessions: translate("calendar.panel.repeat.sessionsLeft", {
        count: series.sessionsLeft,
      }),
    }),
  };
}
