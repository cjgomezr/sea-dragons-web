import { addClubDays } from "@/lib/time/club-calendar";

/**
 * Los grupos por día de la agenda (#647, RF-6 del PRD de E24). La API ya
 * sirve los eventos en orden, así que un día son los eventos seguidos que
 * caen en él. Hoy lleva "TODAY" y el sábado y el domingo de la semana en
 * curso, "This weekend". La semana va de lunes a domingo.
 */

export type AgendaDay<Event> = {
  readonly date: string;
  readonly events: readonly Event[];
};

export type AgendaDayKind = "today" | "thisWeekend" | "otherDay";

const SATURDAY_FROM_MONDAY = 5;
const SUNDAY_FROM_MONDAY = 6;

export function groupAgendaByDay<Event extends { readonly startsOn: string }>(
  events: readonly Event[],
): readonly AgendaDay<Event>[] {
  return events.reduce<AgendaDay<Event>[]>((days, event) => {
    const last = days.at(-1);
    if (last?.date === event.startsOn) {
      return [
        ...days.slice(0, -1),
        { ...last, events: [...last.events, event] },
      ];
    }
    return [...days, { date: event.startsOn, events: [event] }];
  }, []);
}

/** El lunes de la semana de `date` (YYYY-MM-DD). */
function mondayOf(date: string): string {
  // getUTCDay cuenta desde el domingo (0); el lunes es el 1.
  const daysSinceMonday =
    (new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7;
  return addClubDays(date, -daysSinceMonday);
}

export function classifyAgendaDay(date: string, today: string): AgendaDayKind {
  if (date === today) {
    return "today";
  }
  const monday = mondayOf(today);
  const isThisWeekend =
    date === addClubDays(monday, SATURDAY_FROM_MONDAY) ||
    date === addClubDays(monday, SUNDAY_FROM_MONDAY);
  return isThisWeekend ? "thisWeekend" : "otherDay";
}
