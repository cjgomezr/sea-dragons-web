import type { CSSProperties } from "react";
import { formatCalendarDayParts, formatDashboardDay } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import { calendarYearOf } from "@/lib/time/club-calendar";
import type { TrainingDay, TrainingWeek } from "@/lib/training/training-plan";
import {
  type TrainingDayContent,
  exerciseCount,
} from "@/lib/training/training-week-view";

/** Cómo se escriben los días y los colores de la semana del socio (#900). */

const ROUTINE_NAME_SEPARATOR = " + ";

/** "Thu 22 Apr 2027", "jue 22 abr 2027": la fecha del evento y la del
 * principio y el final del ciclo. */
export function formatDayWithYear(locale: Locale, isoDate: string): string {
  return `${formatDashboardDay(locale, isoDate)} ${calendarYearOf(isoDate)}`;
}

/** "26 Oct", "26 oct": el día de una fila y los extremos de la semana. */
export function formatShortDate(locale: Locale, isoDate: string): string {
  const { day, month } = formatCalendarDayParts(locale, isoDate);
  return `${Number(day)} ${month}`;
}

export function formatWeekRange(
  translate: Translator,
  week: TrainingWeek,
): string {
  const first = week.days.at(0);
  const last = week.days.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error(`La semana ${week.number} llegó sin días.`);
  }
  return translate("training.member.weekRange", {
    start: formatShortDate(translate.locale, first.date),
    end: formatShortDate(translate.locale, last.date),
  });
}

/** El color de una rutina, por tema (D15). Va en línea sobre la variable
 * que la hoja lee, como el color de un equipo. */
export function routineColorStyle(colorIndex: number): CSSProperties {
  return {
    "--routine-color": `var(--color-routine-${colorIndex})`,
  } as CSSProperties;
}

/** El nombre de lo que hay un día: sus rutinas, el descanso o el evento. */
export function describeDayContent(
  translate: Translator,
  content: TrainingDayContent,
): string {
  switch (content.kind) {
    case "routines":
      return content.routines
        .map((routine) => routine.name)
        .join(ROUTINE_NAME_SEPARATOR);
    case "rest":
      return translate("training.member.rest");
    case "event":
      return content.eventName;
  }
}

/** Los ejercicios de todas las rutinas de un día. */
export function dayExerciseCount(day: TrainingDay): number {
  return day.routines.reduce(
    (total, routine) => total + exerciseCount(routine),
    0,
  );
}
