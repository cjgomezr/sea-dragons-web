import { formatCalendarDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { clubCalendarDate } from "@/lib/time/club-calendar";

/** Un instante como el día de Melbourne en que cae ("1 July 2026"). */
export function formatClubDay(translate: Translator, instant: string): string {
  return formatCalendarDay(
    translate.locale,
    clubCalendarDate(new Date(instant)),
  );
}
