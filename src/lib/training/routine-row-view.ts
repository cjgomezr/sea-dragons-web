import { isValidMarkValue } from "./member-marks";
import {
  type TrainingMarkRef,
  type TrainingPrescription,
  type WeekDose,
  trainingLoadFor,
} from "./training-load";
import type { TrainingRoutineItem } from "./training-plan";

/**
 * Lo que una fila de la rutina del día decide antes de pintarse (#901, RF-4
 * y D10 del PRD de E35): su dosis y su carga con las marcas del socio, qué
 * marca pide el campo de la fila y qué marcas faltan bajo la lista. Puro,
 * para que los kilos cambien al momento cuando el socio escribe su marca.
 */

/** El valor de cada marca que el socio tiene, por id de marca. */
export type MarkValues = ReadonlyMap<string, number>;

export type ExerciseRow = Extract<TrainingRoutineItem, { kind: "exercise" }>;

type RowContext = {
  /** La dosis de la semana que se mira; nula si esa semana no tiene. */
  readonly weekDose: WeekDose | null;
  readonly markValues: MarkValues;
};

/** Lo que el socio escribió en un campo de marca. */
export type MarkInput =
  | { readonly kind: "empty" }
  | { readonly kind: "value"; readonly value: number }
  | { readonly kind: "invalid" };

/** Un número con punto o coma decimal, y nada más. */
const DECIMAL_PATTERN = /^\d+(?:[.,]\d+)?$/;

export function parseMarkInput(text: string): MarkInput {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { kind: "empty" };
  }
  if (!DECIMAL_PATTERN.test(trimmed)) {
    return { kind: "invalid" };
  }
  const value = Number(trimmed.replace(",", "."));
  return isValidMarkValue(value)
    ? { kind: "value", value }
    : { kind: "invalid" };
}

export function rowPrescription(
  row: ExerciseRow,
  context: RowContext,
): TrainingPrescription {
  const mark = markUsedByRow(row, context.weekDose);
  return trainingLoadFor({
    load: row.load,
    row: { sets: row.sets, reps: row.reps },
    weekDose: context.weekDose,
    markValue: mark === null ? null : (context.markValues.get(mark.id) ?? null),
  });
}

/** La marca de la que salen los kilos de la fila, si salen de alguna. */
export function markUsedByRow(
  row: ExerciseRow,
  weekDose: WeekDose | null,
): TrainingMarkRef | null {
  switch (row.load.kind) {
    case "pct":
      return row.load.mark;
    case "week":
      return weekDose?.intensity.kind === "pct" ? row.load.mark : null;
    case "none":
    case "text":
      return null;
  }
}

/** Las marcas que alguna fila necesita y el socio no tiene, cada una una vez,
 * en el orden en que aparecen. */
export function missingMarksOf(
  items: readonly TrainingRoutineItem[],
  context: RowContext,
): readonly TrainingMarkRef[] {
  const missing = new Map<string, TrainingMarkRef>();
  for (const item of items) {
    if (item.kind !== "exercise") {
      continue;
    }
    const { load } = rowPrescription(item, context);
    if (load.kind === "missingMark" && !missing.has(load.mark.id)) {
      missing.set(load.mark.id, load.mark);
    }
  }
  return [...missing.values()];
}
