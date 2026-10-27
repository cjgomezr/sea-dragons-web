import { describe, expect, it } from "vitest";
import type {
  ActiveTrainingPlan,
  TrainingCycle,
  TrainingDay,
  TrainingRoutine,
  TrainingWeek,
} from "@/lib/training/training-plan";
import {
  defaultSelectedWeekday,
  exerciseCount,
  trainingDayContent,
  weekStripMark,
  weeksToGo,
} from "@/lib/training/training-week-view";

/**
 * Lo que la semana del socio decide antes de pintarse (#900, RF-3 del PRD de
 * E35): qué día abre, qué es cada día, cuántas semanas faltan y cómo se marca
 * cada semana de la franja.
 */

const CYCLE: TrainingCycle = {
  id: "c1",
  name: "Road to Nationals 2027",
  event: { name: "UWR Nationals", date: "2026-11-05" },
  startDate: "2026-10-12",
  endDate: "2026-11-08",
  weeks: 4,
};

const NO_EVENT_CYCLE: TrainingCycle = { ...CYCLE, event: null };

function routine(
  name: string,
  items: TrainingRoutine["items"] = [],
): TrainingRoutine {
  return { id: `r-${name}`, name, colorIndex: 0, items };
}

function exerciseItem(id: string): TrainingRoutine["items"][number] {
  return {
    kind: "exercise",
    id,
    exercise: {
      id: `e-${id}`,
      name: "Back squat",
      tips: [],
      photoUrls: [],
      youtubeUrl: "https://www.youtube.com/results?search_query=squat",
    },
    sets: 4,
    reps: "6",
    rest: null,
    note: null,
    load: { kind: "none" },
  };
}

function day(
  weekday: number,
  date: string,
  routines: readonly TrainingRoutine[] = [],
): TrainingDay {
  return { weekday, date, routines };
}

/** La semana del 26 de octubre: martes y jueves con rutina. */
function weekWith(days: Partial<Record<number, TrainingRoutine[]>>) {
  const dates = [
    "2026-10-26",
    "2026-10-27",
    "2026-10-28",
    "2026-10-29",
    "2026-10-30",
    "2026-10-31",
    "2026-11-01",
  ];
  return {
    number: 3,
    note: null,
    dose: null,
    days: dates.map((date, weekday) => day(weekday, date, days[weekday])),
  } satisfies TrainingWeek;
}

function planAt(
  current: ActiveTrainingPlan["current"],
  cycle: TrainingCycle = CYCLE,
): ActiveTrainingPlan {
  return { cycle, current, week: weekWith({}) };
}

describe("el día que abre la semana", () => {
  it("abre hoy cuando hoy tiene rutina", () => {
    const week = weekWith({ 1: [routine("Gym A")], 3: [routine("Pool")] });

    expect(defaultSelectedWeekday(week, "2026-10-29")).toBe(3);
  });

  it("abre el primer día con rutina cuando hoy descansa", () => {
    const week = weekWith({ 1: [routine("Gym A")], 3: [routine("Pool")] });

    expect(defaultSelectedWeekday(week, "2026-10-28")).toBe(1);
  });

  it("abre el primer día con rutina cuando hoy no es de esa semana", () => {
    const week = weekWith({ 4: [routine("Gym B")], 5: [routine("Pool")] });

    expect(defaultSelectedWeekday(week, "2026-11-20")).toBe(4);
  });

  it("abre el lunes cuando la semana no tiene ninguna rutina", () => {
    expect(defaultSelectedWeekday(weekWith({}), "2026-11-20")).toBe(0);
  });
});

describe("qué es cada día", () => {
  it("es de rutinas cuando tiene una o dos, en su orden", () => {
    const gym = routine("Gym A");
    const pool = routine("Pool");

    expect(
      trainingDayContent(day(1, "2026-10-27", [gym, pool]), CYCLE),
    ).toEqual({ kind: "routines", routines: [gym, pool] });
  });

  it("es descanso cuando no tiene ninguna", () => {
    expect(trainingDayContent(day(2, "2026-10-28"), CYCLE)).toEqual({
      kind: "rest",
    });
  });

  it("es del evento desde la fecha del evento, si no hay nada planificado", () => {
    expect(trainingDayContent(day(3, "2026-11-05"), CYCLE)).toEqual({
      kind: "event",
      eventName: "UWR Nationals",
    });
    expect(trainingDayContent(day(5, "2026-11-07"), CYCLE)).toEqual({
      kind: "event",
      eventName: "UWR Nationals",
    });
  });

  it("es descanso el día antes del evento", () => {
    expect(trainingDayContent(day(2, "2026-11-04"), CYCLE)).toEqual({
      kind: "rest",
    });
  });

  it("enseña lo planificado aunque caiga en un día del evento", () => {
    const gym = routine("Gym A");

    expect(trainingDayContent(day(3, "2026-11-05", [gym]), CYCLE)).toEqual({
      kind: "routines",
      routines: [gym],
    });
  });

  it("no tiene días del evento un ciclo sin evento", () => {
    expect(trainingDayContent(day(3, "2026-11-05"), NO_EVENT_CYCLE)).toEqual({
      kind: "rest",
    });
  });

  it("no tiene días del evento un evento sin fecha", () => {
    const cycle = { ...CYCLE, event: { name: "UWR Nationals", date: null } };

    expect(trainingDayContent(day(3, "2026-11-05"), cycle)).toEqual({
      kind: "rest",
    });
  });
});

describe("los ejercicios de una rutina", () => {
  it("cuenta los ejercicios y no los títulos de sección", () => {
    const gym = routine("Gym A", [
      { kind: "section", id: "s1", title: "Warm up" },
      exerciseItem("i1"),
      exerciseItem("i2"),
    ]);

    expect(exerciseCount(gym)).toBe(2);
  });
});

describe("las semanas que faltan", () => {
  it("son las que quedan después de la actual", () => {
    expect(
      weeksToGo(planAt({ week: 1, phase: "running", today: "2026-10-14" })),
    ).toBe(3);
  });

  it("son cero en la última semana", () => {
    expect(
      weeksToGo(planAt({ week: 4, phase: "running", today: "2026-11-03" })),
    ).toBe(0);
  });
});

describe("la franja de semanas", () => {
  const running = planAt({ week: 2, phase: "running", today: "2026-10-20" });

  it("marca la actual y apaga las pasadas", () => {
    expect(weekStripMark(running, 1)).toEqual({
      isCurrent: false,
      isPast: true,
      isEventWeek: false,
    });
    expect(weekStripMark(running, 2)).toEqual({
      isCurrent: true,
      isPast: false,
      isEventWeek: false,
    });
  });

  it("marca como del evento la última semana de un ciclo con evento", () => {
    expect(weekStripMark(running, 4).isEventWeek).toBe(true);
    expect(weekStripMark(running, 3).isEventWeek).toBe(false);
  });

  it("no marca semana del evento en un ciclo sin evento", () => {
    const plan = planAt(
      { week: 2, phase: "running", today: "2026-10-20" },
      NO_EVENT_CYCLE,
    );

    expect(weekStripMark(plan, 4).isEventWeek).toBe(false);
  });

  it("no marca ninguna como actual ni pasada antes de empezar", () => {
    const plan = planAt({
      week: 1,
      phase: "not_started",
      today: "2026-10-01",
    });

    expect(weekStripMark(plan, 1)).toEqual({
      isCurrent: false,
      isPast: false,
      isEventWeek: false,
    });
  });

  it("apaga todas, sin ninguna actual, con el ciclo terminado", () => {
    const plan = planAt({ week: 4, phase: "finished", today: "2026-11-20" });

    expect(weekStripMark(plan, 4)).toEqual({
      isCurrent: false,
      isPast: true,
      isEventWeek: true,
    });
  });
});
