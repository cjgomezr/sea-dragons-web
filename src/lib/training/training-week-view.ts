import type {
  ActiveTrainingPlan,
  TrainingCycle,
  TrainingDay,
  TrainingRoutine,
  TrainingWeek,
} from "./training-plan";

/**
 * Lo que la semana del socio decide antes de pintarse (#900, RF-3 del PRD de
 * E35): qué es cada día, qué día abre, cuántas semanas faltan y cómo se marca
 * cada semana de la franja. Puro, para probarlo sin la pantalla.
 */

const MONDAY = 0;

/** Un día con lo planificado, de descanso, o del evento: desde la fecha del
 * evento hasta el final del ciclo, si nadie planificó nada ahí. */
export type TrainingDayContent =
  | { readonly kind: "routines"; readonly routines: readonly TrainingRoutine[] }
  | { readonly kind: "rest" }
  | { readonly kind: "event"; readonly eventName: string };

export function trainingDayContent(
  day: TrainingDay,
  cycle: TrainingCycle,
): TrainingDayContent {
  if (day.routines.length > 0) {
    return { kind: "routines", routines: day.routines };
  }
  const event = datedEventOf(cycle);
  if (event !== null && day.date >= event.date) {
    return { kind: "event", eventName: event.name };
  }
  return { kind: "rest" };
}

/** El evento del ciclo, si tiene fecha: sin ella no hay días ni semana del
 * evento que marcar. */
function datedEventOf(
  cycle: TrainingCycle,
): { readonly name: string; readonly date: string } | null {
  const { event } = cycle;
  if (event === null || event.date === null) {
    return null;
  }
  return { name: event.name, date: event.date };
}

function hasRoutines(day: TrainingDay): boolean {
  return day.routines.length > 0;
}

/** Hoy si tiene rutina; si no, el primer día de la semana que la tenga; y en
 * una semana sin ninguna, el lunes. */
export function defaultSelectedWeekday(
  week: TrainingWeek,
  today: string,
): number {
  const todayInWeek = week.days.find((day) => day.date === today);
  if (todayInWeek !== undefined && hasRoutines(todayInWeek)) {
    return todayInWeek.weekday;
  }
  return week.days.find(hasRoutines)?.weekday ?? MONDAY;
}

export function exerciseCount(routine: TrainingRoutine): number {
  return routine.items.filter((item) => item.kind === "exercise").length;
}

export function weeksToGo(plan: ActiveTrainingPlan): number {
  return plan.cycle.weeks - plan.current.week;
}

export type WeekStripMark = {
  readonly isCurrent: boolean;
  readonly isPast: boolean;
  /** La última semana de un ciclo con evento, que es la del evento (D5). */
  readonly isEventWeek: boolean;
};

export function weekStripMark(
  plan: ActiveTrainingPlan,
  weekNumber: number,
): WeekStripMark {
  const { phase, week } = plan.current;
  return {
    isCurrent: phase === "running" && weekNumber === week,
    isPast: phase === "finished" || (phase === "running" && weekNumber < week),
    isEventWeek:
      datedEventOf(plan.cycle) !== null && weekNumber === plan.cycle.weeks,
  };
}
