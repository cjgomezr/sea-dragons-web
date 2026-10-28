import { describe, expect, it } from "vitest";
import type { MemberMark } from "@/lib/training/member-marks";
import { myMarksView } from "@/lib/training/my-marks-view";
import type {
  RoutineLoad,
  TrainingMarkRef,
  WeekDose,
} from "@/lib/training/training-load";
import type {
  TrainingRoutine,
  TrainingWeek,
} from "@/lib/training/training-plan";

/**
 * Qué enseña la tarjeta Mis marcas (#902, RF-5 del PRD de E35, §4.1 del
 * handoff): con más de cuatro marcas, solo las que usan las rutinas de la
 * semana que se mira, con un conmutador para ver el resto.
 */

const SQUAT: TrainingMarkRef = { id: "mark-squat", name: "Back squat" };
const BENCH: TrainingMarkRef = { id: "mark-bench", name: "Bench press" };
const DEADLIFT: TrainingMarkRef = { id: "mark-deadlift", name: "Deadlift" };
const CLEAN: TrainingMarkRef = { id: "mark-clean", name: "Power clean" };
const PRESS: TrainingMarkRef = { id: "mark-press", name: "Overhead press" };

function mark(ref: TrainingMarkRef, value: number | null = null): MemberMark {
  return { ...ref, unit: "kg", value };
}

function routine(loads: readonly RoutineLoad[]): TrainingRoutine {
  return {
    id: "routine",
    name: "Gym A",
    colorIndex: 0,
    items: [
      { kind: "section", id: "section", title: "Main" },
      ...loads.map((load, index) => ({
        kind: "exercise" as const,
        id: `row-${index}`,
        exercise: {
          id: `exercise-${index}`,
          name: `Exercise ${index}`,
          tips: [],
          photoUrls: [],
          youtubeUrl: "https://www.youtube.com/results?search_query=x",
        },
        sets: 3,
        reps: "8",
        rest: null,
        note: null,
        load,
      })),
    ],
  };
}

function week(
  routines: readonly TrainingRoutine[],
  dose: WeekDose | null = null,
): TrainingWeek {
  return {
    number: 3,
    note: null,
    dose,
    days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      date: `2026-10-${26 + weekday}`,
      routines: weekday === 1 ? routines : [],
    })),
  };
}

const PCT_DOSE: WeekDose = {
  sets: 4,
  reps: "5",
  intensity: { kind: "pct", pct: 80 },
};
const TEXT_DOSE: WeekDose = {
  sets: 4,
  reps: "5",
  intensity: { kind: "text", text: "RPE 7" },
};

const THREE_MARKS = [mark(SQUAT, 80), mark(BENCH, 55), mark(DEADLIFT)];
const SIX_MARKS = [
  mark(SQUAT, 80),
  mark(BENCH, 55),
  mark(DEADLIFT),
  mark(CLEAN),
  mark(PRESS, 40),
  mark({ id: "mark-row", name: "Bent-over row" }),
];

function names(view: ReturnType<typeof myMarksView>): readonly string[] {
  return view.entries.map((entry) => entry.mark.name);
}

describe("myMarksView", () => {
  it("cuenta cuántas marcas tienen valor y cuántas hay", () => {
    const view = myMarksView({
      marks: THREE_MARKS,
      week: week([]),
      showAll: false,
    });

    expect(view.setCount).toBe(2);
    expect(view.total).toBe(3);
  });

  it("enseña todas, sin conmutador ni 'this week', con cuatro marcas o menos", () => {
    const view = myMarksView({
      marks: THREE_MARKS,
      week: week([routine([{ kind: "pct", mark: SQUAT, pct: 75 }])]),
      showAll: false,
    });

    expect(names(view)).toEqual(["Back squat", "Bench press", "Deadlift"]);
    expect(view.entries.every((entry) => !entry.isThisWeek)).toBe(true);
    expect(view.toggle).toBe("none");
  });

  it("con más de cuatro, enseña solo las que usan las rutinas de la semana, en el orden del club", () => {
    const view = myMarksView({
      marks: SIX_MARKS,
      week: week([
        routine([
          { kind: "pct", mark: PRESS, pct: 70 },
          { kind: "pct", mark: SQUAT, pct: 75 },
          { kind: "text", text: "Bodyweight" },
        ]),
      ]),
      showAll: false,
    });

    expect(names(view)).toEqual(["Back squat", "Overhead press"]);
    expect(view.entries.every((entry) => entry.isThisWeek)).toBe(true);
    expect(view.toggle).toBe("showAll");
  });

  it("cuenta la marca de una fila con la dosis de la semana cuando la dosis es un %", () => {
    const view = myMarksView({
      marks: SIX_MARKS,
      week: week([routine([{ kind: "week", mark: CLEAN }])], PCT_DOSE),
      showAll: false,
    });

    expect(names(view)).toEqual(["Power clean"]);
  });

  it("enseña las tres primeras si ninguna rutina de la semana usa marcas", () => {
    const view = myMarksView({
      marks: SIX_MARKS,
      week: week([routine([{ kind: "week", mark: CLEAN }])], TEXT_DOSE),
      showAll: false,
    });

    expect(names(view)).toEqual(["Back squat", "Bench press", "Deadlift"]);
    expect(view.entries.every((entry) => !entry.isThisWeek)).toBe(true);
    expect(view.toggle).toBe("showAll");
  });

  it("con 'Show all' enseña todas y marca las de la semana", () => {
    const view = myMarksView({
      marks: SIX_MARKS,
      week: week([routine([{ kind: "pct", mark: BENCH, pct: 75 }])]),
      showAll: true,
    });

    expect(names(view)).toHaveLength(6);
    expect(
      view.entries
        .filter((entry) => entry.isThisWeek)
        .map((entry) => entry.mark.name),
    ).toEqual(["Bench press"]);
    expect(view.toggle).toBe("showWeek");
  });

  it("no ofrece el conmutador cuando la semana ya usa todas", () => {
    const view = myMarksView({
      marks: SIX_MARKS,
      week: week([
        routine(
          SIX_MARKS.map((entry) => ({
            kind: "pct" as const,
            mark: { id: entry.id, name: entry.name },
            pct: 70,
          })),
        ),
      ]),
      showAll: false,
    });

    expect(names(view)).toHaveLength(6);
    expect(view.toggle).toBe("none");
  });
});
