import { describe, expect, it } from "vitest";
import {
  type RoutineLoad,
  type WeekDose,
  kilosFor,
  trainingLoadFor,
} from "@/lib/training/training-load";

/**
 * La carga de una fila de rutina (#898, D10 del PRD de E35): pura, porque la
 * pantalla la recalcula al momento cuando el socio escribe su marca (#901).
 */

const SQUAT = { id: "mark-squat", name: "Back squat" };
const ROW = { sets: 3, reps: "8" };

const PCT_LOAD: RoutineLoad = { kind: "pct", mark: SQUAT, pct: 75 };
const WEEK_LOAD: RoutineLoad = { kind: "week", mark: SQUAT };

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

describe("kilosFor", () => {
  it("da 60 kg con una marca de 80 y un 75%", () => {
    expect(kilosFor({ markValue: 80, pct: 75 })).toBe(60);
  });

  it("da 42,5 kg con una marca de 55 y un 75%", () => {
    expect(kilosFor({ markValue: 55, pct: 75 })).toBe(42.5);
  });

  it.each([
    { markValue: 100, pct: 61, kilos: 60 },
    { markValue: 100, pct: 64, kilos: 65 },
    { markValue: 82.5, pct: 70, kilos: 57.5 },
    { markValue: 101, pct: 50, kilos: 50 },
  ])(
    "redondea $markValue al $pct% al múltiplo de 2,5 más cercano ($kilos)",
    ({ markValue, pct, kilos }) => {
      expect(kilosFor({ markValue, pct })).toBe(kilos);
    },
  );
});

describe("trainingLoadFor", () => {
  it("sin carga deja las series y repeticiones de la fila", () => {
    const prescription = trainingLoadFor({
      load: { kind: "none" },
      row: ROW,
      weekDose: PCT_DOSE,
      markValue: 80,
    });

    expect(prescription).toEqual({
      sets: 3,
      reps: "8",
      load: { kind: "none" },
    });
  });

  it("con texto lo devuelve tal cual", () => {
    const prescription = trainingLoadFor({
      load: { kind: "text", text: "Bodyweight" },
      row: ROW,
      weekDose: null,
      markValue: null,
    });

    expect(prescription).toEqual({
      sets: 3,
      reps: "8",
      load: { kind: "text", text: "Bodyweight" },
    });
  });

  it("con % de una marca y la marca puesta da los kilos", () => {
    const prescription = trainingLoadFor({
      load: PCT_LOAD,
      row: ROW,
      weekDose: null,
      markValue: 80,
    });

    expect(prescription.load).toEqual({
      kind: "kilos",
      mark: SQUAT,
      pct: 75,
      kilos: 60,
    });
  });

  it("con % de una marca y sin la marca pide la marca", () => {
    const prescription = trainingLoadFor({
      load: PCT_LOAD,
      row: ROW,
      weekDose: null,
      markValue: null,
    });

    expect(prescription.load).toEqual({
      kind: "missingMark",
      mark: SQUAT,
      pct: 75,
    });
  });

  it("el % fijo no cambia con la dosis de la semana", () => {
    const prescription = trainingLoadFor({
      load: PCT_LOAD,
      row: ROW,
      weekDose: PCT_DOSE,
      markValue: 80,
    });

    expect(prescription).toMatchObject({ sets: 3, reps: "8" });
    expect(prescription.load).toMatchObject({ pct: 75, kilos: 60 });
  });

  it("la dosis de la semana con % toma sus series, repeticiones y kilos", () => {
    const prescription = trainingLoadFor({
      load: WEEK_LOAD,
      row: ROW,
      weekDose: PCT_DOSE,
      markValue: 100,
    });

    expect(prescription).toEqual({
      sets: 4,
      reps: "5",
      load: { kind: "kilos", mark: SQUAT, pct: 80, kilos: 80 },
    });
  });

  it("la dosis de la semana con % y sin la marca pide la marca", () => {
    const prescription = trainingLoadFor({
      load: WEEK_LOAD,
      row: ROW,
      weekDose: PCT_DOSE,
      markValue: null,
    });

    expect(prescription).toEqual({
      sets: 4,
      reps: "5",
      load: { kind: "missingMark", mark: SQUAT, pct: 80 },
    });
  });

  it("la dosis de la semana con texto da sus series, repeticiones y el texto", () => {
    const prescription = trainingLoadFor({
      load: WEEK_LOAD,
      row: ROW,
      weekDose: TEXT_DOSE,
      markValue: 100,
    });

    expect(prescription).toEqual({
      sets: 3,
      reps: "6",
      load: { kind: "text", text: "RPE 7" },
    });
  });

  it("la dosis de la semana sin dosis deja las de la fila, sin kilos", () => {
    const prescription = trainingLoadFor({
      load: WEEK_LOAD,
      row: ROW,
      weekDose: null,
      markValue: 100,
    });

    expect(prescription).toEqual({
      sets: 3,
      reps: "8",
      load: { kind: "none" },
    });
  });

  it("una dosis sin series ni repeticiones deja las de la fila", () => {
    const prescription = trainingLoadFor({
      load: WEEK_LOAD,
      row: ROW,
      weekDose: { sets: null, reps: null, intensity: { kind: "pct", pct: 70 } },
      markValue: 100,
    });

    expect(prescription).toEqual({
      sets: 3,
      reps: "8",
      load: { kind: "kilos", mark: SQUAT, pct: 70, kilos: 70 },
    });
  });

  it("una dosis sin intensidad da sus series y repeticiones, sin kilos", () => {
    const prescription = trainingLoadFor({
      load: WEEK_LOAD,
      row: ROW,
      weekDose: { sets: 5, reps: "3", intensity: { kind: "none" } },
      markValue: 100,
    });

    expect(prescription).toEqual({
      sets: 5,
      reps: "3",
      load: { kind: "none" },
    });
  });
});
