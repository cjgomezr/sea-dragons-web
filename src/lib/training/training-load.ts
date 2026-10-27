/**
 * La carga de una fila de rutina (#898, D10 del PRD de E35). Pura: la API
 * sirve la carga tal como la planificó el entrenador, y la pantalla la
 * resuelve con la marca del socio, también al momento cuando la escribe
 * (#901).
 */

/** La marca del club sobre la que se calcula una carga (D11). */
export type TrainingMarkRef = {
  readonly id: string;
  readonly name: string;
};

/** Una de las cuatro cargas de D10: nada, % fijo de una marca, la dosis de la
 * semana sobre una marca, o un texto ("Bodyweight"). */
export type RoutineLoad =
  | { readonly kind: "none" }
  | {
      readonly kind: "pct";
      readonly mark: TrainingMarkRef;
      readonly pct: number;
    }
  | { readonly kind: "week"; readonly mark: TrainingMarkRef }
  | { readonly kind: "text"; readonly text: string };

/** La intensidad de la dosis de la semana: un % de la marca o un texto
 * ("RPE 7"), o ninguna (D6). */
export type DoseIntensity =
  | { readonly kind: "none" }
  | { readonly kind: "pct"; readonly pct: number }
  | { readonly kind: "text"; readonly text: string };

/** Lo que cambia semana a semana en el ejercicio principal (D6). */
export type WeekDose = {
  readonly sets: number | null;
  readonly reps: string | null;
  readonly intensity: DoseIntensity;
};

/** La carga ya resuelta con la marca del socio. */
export type ResolvedLoad =
  | { readonly kind: "none" }
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "kilos";
      readonly mark: TrainingMarkRef;
      readonly pct: number;
      /** La marca del socio de la que salen, para decir "75% of back squat
       * 80". */
      readonly markValue: number;
      readonly kilos: number;
    }
  | {
      readonly kind: "missingMark";
      readonly mark: TrainingMarkRef;
      readonly pct: number;
    };

/** Lo que el socio ve en la fila: series, repeticiones y la carga. */
export type TrainingPrescription = {
  readonly sets: number | null;
  readonly reps: string | null;
  readonly load: ResolvedLoad;
};

export type TrainingLoadInput = {
  readonly load: RoutineLoad;
  /** Las series y repeticiones que la fila trae por sí misma. */
  readonly row: { readonly sets: number | null; readonly reps: string | null };
  /** La dosis de la semana que se mira; nula si esa semana no tiene. */
  readonly weekDose: WeekDose | null;
  /** La marca del socio, en kg; nula si no la registró. */
  readonly markValue: number | null;
};

/** Los kilos se redondean a lo que se puede cargar en una barra (D10). */
const PLATE_STEP_KG = 2.5;
const PERCENT = 100;

/** `round(marca × % / 100 / 2,5) × 2,5`, en una sola división para que la
 * coma flotante no deje un 16,4999 donde iba un 16,5. */
export function kilosFor(input: {
  readonly markValue: number;
  readonly pct: number;
}): number {
  const steps = Math.round(
    (input.markValue * input.pct) / (PERCENT * PLATE_STEP_KG),
  );
  return steps * PLATE_STEP_KG;
}

function percentOfMark(
  mark: TrainingMarkRef,
  pct: number,
  markValue: number | null,
): ResolvedLoad {
  return markValue === null
    ? { kind: "missingMark", mark, pct }
    : {
        kind: "kilos",
        mark,
        pct,
        markValue,
        kilos: kilosFor({ markValue, pct }),
      };
}

function weekIntensityLoad(
  mark: TrainingMarkRef,
  intensity: DoseIntensity,
  markValue: number | null,
): ResolvedLoad {
  switch (intensity.kind) {
    case "none":
      return { kind: "none" };
    case "text":
      return { kind: "text", text: intensity.text };
    case "pct":
      return percentOfMark(mark, intensity.pct, markValue);
  }
}

/** La dosis de la semana manda sobre la fila en lo que trae; lo que la
 * semana deja vacío lo pone la fila. Sin dosis, la fila sin kilos (RF-4). */
function weekPrescription(
  mark: TrainingMarkRef,
  input: TrainingLoadInput,
): TrainingPrescription {
  const { weekDose, row } = input;
  if (weekDose === null) {
    return { ...row, load: { kind: "none" } };
  }
  return {
    sets: weekDose.sets ?? row.sets,
    reps: weekDose.reps ?? row.reps,
    load: weekIntensityLoad(mark, weekDose.intensity, input.markValue),
  };
}

export function trainingLoadFor(
  input: TrainingLoadInput,
): TrainingPrescription {
  const { load, row } = input;
  switch (load.kind) {
    case "none":
      return { ...row, load };
    case "text":
      return { ...row, load };
    case "pct":
      return {
        ...row,
        load: percentOfMark(load.mark, load.pct, input.markValue),
      };
    case "week":
      return weekPrescription(load.mark, input);
  }
}
