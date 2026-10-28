import { describe, expect, it } from "vitest";
import type { RoutineLoad, WeekDose } from "@/lib/training/training-load";
import type { TrainingRoutineItem } from "@/lib/training/training-plan";
import {
  type MarkValues,
  markUsedByRow,
  missingMarksOf,
  parseMarkInput,
  rowPrescription,
} from "@/lib/training/routine-row-view";

/**
 * Lo que una fila de la rutina del día decide antes de pintarse (#901, RF-4
 * del PRD de E35): su dosis y su carga con las marcas del socio, qué marca
 * pide el campo de la fila y qué marcas faltan bajo la lista.
 */

const SQUAT = { id: "mark-squat", name: "Back squat" };
const DEADLIFT = { id: "mark-deadlift", name: "Deadlift" };

type ExerciseItem = Extract<TrainingRoutineItem, { kind: "exercise" }>;

function row(load: RoutineLoad, id = "row"): ExerciseItem {
  return {
    kind: "exercise",
    id,
    exercise: {
      id: `e-${id}`,
      name: "Back squat",
      tips: [],
      photoUrls: [],
      youtubeUrl: "https://www.youtube.com/results?search_query=x",
    },
    sets: 3,
    reps: "8",
    rest: "2:00",
    note: null,
    load,
  };
}

const PCT_DOSE: WeekDose = {
  sets: 4,
  reps: "5",
  intensity: { kind: "pct", pct: 80 },
};
const TEXT_DOSE: WeekDose = {
  sets: 3,
  reps: "6",
  intensity: { kind: "text", text: "RPE 7" },
};

const NO_MARKS: MarkValues = new Map();
const SQUAT_80: MarkValues = new Map([[SQUAT.id, 80]]);

describe("parseMarkInput", () => {
  it.each([
    ["80", 80],
    ["82.5", 82.5],
    ["82,5", 82.5],
    [" 100 ", 100],
    ["500", 500],
  ])("entiende %j como %d", (text, value) => {
    expect(parseMarkInput(text)).toEqual({ kind: "value", value });
  });

  it("entiende un campo vacío como sin valor", () => {
    expect(parseMarkInput("  ")).toEqual({ kind: "empty" });
  });

  it.each(["0", "-5", "500.5", "82.25", "abc", "8 0"])("rechaza %j", (text) => {
    expect(parseMarkInput(text)).toEqual({ kind: "invalid" });
  });
});

describe("rowPrescription", () => {
  it("resuelve los kilos de un % con la marca del socio", () => {
    const prescription = rowPrescription(
      row({ kind: "pct", mark: SQUAT, pct: 75 }),
      { weekDose: null, markValues: SQUAT_80 },
    );

    expect(prescription.load).toEqual({
      kind: "kilos",
      mark: SQUAT,
      pct: 75,
      markValue: 80,
      kilos: 60,
    });
  });

  it("pide la marca cuando el socio no la tiene", () => {
    const prescription = rowPrescription(
      row({ kind: "pct", mark: SQUAT, pct: 75 }),
      { weekDose: null, markValues: NO_MARKS },
    );

    expect(prescription.load).toEqual({
      kind: "missingMark",
      mark: SQUAT,
      pct: 75,
    });
  });

  it("toma la dosis de la semana cuando la carga es la de la semana", () => {
    const prescription = rowPrescription(row({ kind: "week", mark: SQUAT }), {
      weekDose: PCT_DOSE,
      markValues: SQUAT_80,
    });

    expect(prescription).toEqual({
      sets: 4,
      reps: "5",
      load: { kind: "kilos", mark: SQUAT, pct: 80, markValue: 80, kilos: 65 },
    });
  });
});

describe("markUsedByRow", () => {
  it("es la marca de un % fijo", () => {
    expect(
      markUsedByRow(row({ kind: "pct", mark: SQUAT, pct: 75 }), null),
    ).toBe(SQUAT);
  });

  it("es la marca de la semana cuando su intensidad es un %", () => {
    expect(markUsedByRow(row({ kind: "week", mark: SQUAT }), PCT_DOSE)).toBe(
      SQUAT,
    );
  });

  it("no hay marca cuando la semana trae un texto o no trae dosis", () => {
    const weekRow = row({ kind: "week", mark: SQUAT });

    expect(markUsedByRow(weekRow, TEXT_DOSE)).toBeNull();
    expect(markUsedByRow(weekRow, null)).toBeNull();
  });

  it("no hay marca sin carga o con una carga de texto", () => {
    expect(markUsedByRow(row({ kind: "none" }), PCT_DOSE)).toBeNull();
    expect(
      markUsedByRow(row({ kind: "text", text: "Bodyweight" }), PCT_DOSE),
    ).toBeNull();
  });
});

describe("missingMarksOf", () => {
  it("nombra una vez cada marca que falta, en el orden de las filas", () => {
    const items: TrainingRoutineItem[] = [
      { kind: "section", id: "s", title: "Main" },
      row({ kind: "pct", mark: DEADLIFT, pct: 60 }, "a"),
      row({ kind: "pct", mark: SQUAT, pct: 75 }, "b"),
      row({ kind: "week", mark: DEADLIFT }, "c"),
      row({ kind: "pct", mark: SQUAT, pct: 70 }, "d"),
    ];

    expect(
      missingMarksOf(items, { weekDose: PCT_DOSE, markValues: NO_MARKS }),
    ).toEqual([DEADLIFT, SQUAT]);
  });

  it("no nombra las marcas que el socio ya tiene", () => {
    const items = [row({ kind: "pct", mark: SQUAT, pct: 75 })];

    expect(
      missingMarksOf(items, { weekDose: null, markValues: SQUAT_80 }),
    ).toEqual([]);
  });
});
