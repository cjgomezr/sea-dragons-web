import type { CycleSchedule } from "./cycle-schedule";
import type { DoseIntensity, WeekDose } from "./training-load";

/**
 * Qué vale al crear o cambiar un ciclo, su semana y su cuadrícula (#904, D5 a
 * D7 del PRD de E35). Los límites son los de `0083_training.sql`: la base los
 * vuelve a imponer, pero aquí se dice cuál falló. Los textos se recortan, y
 * uno vacío es que no hay.
 */

/** `training_cycles_name_length` y `training_cycles_event_name_length`. */
export const CYCLE_NAME_MAX_LENGTH = 80;
export const CYCLE_EVENT_NAME_MAX_LENGTH = 80;
export const CYCLE_MIN_WEEKS = 1;
export const CYCLE_MAX_WEEKS = 52;
/** Las de `training_cycle_weeks`. */
export const WEEK_NOTE_MAX_LENGTH = 140;
export const DOSE_MIN_SETS = 1;
export const DOSE_MAX_SETS = 99;
export const DOSE_REPS_MAX_LENGTH = 20;
export const DOSE_MIN_PCT = 1;
export const DOSE_MAX_PCT = 150;
export const DOSE_TEXT_MAX_LENGTH = 20;
/** `numeric(4, 1)`: un decimal como mucho, o la base lo redondearía. */
const PCT_DECIMAL_SCALE = 10;
/** El margen del punto flotante: 1,1 × 10 no da 11 exacto. */
const FLOAT_TOLERANCE = 1e-9;
const MONDAY = 0;
const SUNDAY = 6;

export type CycleIssueCode =
  | "name_required"
  | "name_too_long"
  | "weeks_out_of_range"
  | "event_name_required"
  | "event_name_too_long"
  | "week_out_of_range"
  | "weekday_out_of_range"
  | "note_too_long"
  | "dose_sets_out_of_range"
  | "dose_reps_too_long"
  | "dose_pct_out_of_range"
  | "dose_text_required"
  | "dose_text_too_long"
  | "routine_not_allowed"
  | "too_few_weeks_to_copy";

export class CycleValidationError extends Error {
  readonly code: CycleIssueCode;

  constructor(code: CycleIssueCode) {
    super(`El ciclo no vale: ${code}.`);
    this.name = "CycleValidationError";
    this.code = code;
  }
}

/** Como `char_length` de Postgres: un emoji es un carácter, no dos. */
function countCharacters(text: string): number {
  return [...text].length;
}

/** Recortado; vacío es nulo. Más largo que `maxLength`, el rechazo. */
function optionalText(
  raw: string | null,
  maxLength: number,
  tooLong: CycleIssueCode,
): string | null {
  const text = raw === null ? "" : raw.trim();
  if (text === "") {
    return null;
  }
  if (countCharacters(text) > maxLength) {
    throw new CycleValidationError(tooLong);
  }
  return text;
}

function requiredText(
  raw: string,
  limits: {
    readonly maxLength: number;
    readonly required: CycleIssueCode;
    readonly tooLong: CycleIssueCode;
  },
): string {
  const text = optionalText(raw, limits.maxLength, limits.tooLong);
  if (text === null) {
    throw new CycleValidationError(limits.required);
  }
  return text;
}

export function validCycleName(raw: string): string {
  return requiredText(raw, {
    maxLength: CYCLE_NAME_MAX_LENGTH,
    required: "name_required",
    tooLong: "name_too_long",
  });
}

export function validCycleWeeks(weeks: number): number {
  if (weeks < CYCLE_MIN_WEEKS || weeks > CYCLE_MAX_WEEKS) {
    throw new CycleValidationError("weeks_out_of_range");
  }
  return weeks;
}

export function validCycleSchedule(schedule: CycleSchedule): CycleSchedule {
  if (schedule.kind === "start") {
    return schedule;
  }
  return {
    ...schedule,
    eventName: requiredText(schedule.eventName, {
      maxLength: CYCLE_EVENT_NAME_MAX_LENGTH,
      required: "event_name_required",
      tooLong: "event_name_too_long",
    }),
  };
}

/** Una semana que el ciclo tiene: de la 1 a la última. */
export function validWeekNo(weekNo: number, cycleWeeks: number): number {
  if (weekNo < CYCLE_MIN_WEEKS || weekNo > cycleWeeks) {
    throw new CycleValidationError("week_out_of_range");
  }
  return weekNo;
}

/** 0 es el lunes; 6, el domingo. */
export function validWeekday(weekday: number): number {
  if (weekday < MONDAY || weekday > SUNDAY) {
    throw new CycleValidationError("weekday_out_of_range");
  }
  return weekday;
}

export function validWeekNote(raw: string | null): string | null {
  return optionalText(raw, WEEK_NOTE_MAX_LENGTH, "note_too_long");
}

function hasAtMostOneDecimal(value: number): boolean {
  const scaled = value * PCT_DECIMAL_SCALE;
  return Math.abs(scaled - Math.round(scaled)) < FLOAT_TOLERANCE;
}

function validIntensity(intensity: DoseIntensity): DoseIntensity {
  switch (intensity.kind) {
    case "none":
      return intensity;
    case "pct":
      if (
        intensity.pct < DOSE_MIN_PCT ||
        intensity.pct > DOSE_MAX_PCT ||
        !hasAtMostOneDecimal(intensity.pct)
      ) {
        throw new CycleValidationError("dose_pct_out_of_range");
      }
      return intensity;
    case "text":
      return {
        kind: "text",
        text: requiredText(intensity.text, {
          maxLength: DOSE_TEXT_MAX_LENGTH,
          required: "dose_text_required",
          tooLong: "dose_text_too_long",
        }),
      };
  }
}

/** Sin series, repeticiones ni intensidad, la semana no tiene dosis (D6). */
export function validWeekDose(dose: WeekDose | null): WeekDose | null {
  if (dose === null) {
    return null;
  }
  if (
    dose.sets !== null &&
    (dose.sets < DOSE_MIN_SETS || dose.sets > DOSE_MAX_SETS)
  ) {
    throw new CycleValidationError("dose_sets_out_of_range");
  }
  const reps = optionalText(
    dose.reps,
    DOSE_REPS_MAX_LENGTH,
    "dose_reps_too_long",
  );
  const intensity = validIntensity(dose.intensity);
  if (dose.sets === null && reps === null && intensity.kind === "none") {
    return null;
  }
  return { sets: dose.sets, reps, intensity };
}
