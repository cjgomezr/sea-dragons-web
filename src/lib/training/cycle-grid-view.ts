import type {
  CycleDayChange,
  CycleDayRecord,
  CycleWeekRecord,
  ManagedCycle,
} from "./club-cycles";
import type { CycleIssueCode } from "./club-cycle-input";
import {
  MIN_WEEKS_TO_COPY_WEEK_ONE,
  weekOneCopyTargets,
} from "./cycle-schedule";
import { cycleWeekAt } from "./cycle-week";
import type { DoseIntensity, WeekDose } from "./training-load";

/**
 * Lo que la cuadrícula de Planificar → Ciclo (#907, RF-8, D6 y D7 del PRD de
 * E35) calcula antes de pintar: qué rutinas tiene cada día, qué queda al
 * cambiar una ranura, qué semana es hoy y qué se manda al salir de un campo
 * de la nota o la dosis.
 */

/** 0 es el lunes, como en `training_cycle_days`. */
export const GRID_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export type GridDay = { readonly weekNo: number; readonly weekday: number };

/** Las dos ranuras de un día; la 2 nunca está sin la 1 (D7). */
export type DayRoutines = {
  readonly first: string | null;
  readonly second: string | null;
};

function isOnDay(record: CycleDayRecord, day: GridDay): boolean {
  return record.weekNo === day.weekNo && record.weekday === day.weekday;
}

function routineInSlot(
  days: readonly CycleDayRecord[],
  day: GridDay,
  slot: CycleDayRecord["slot"],
): string | null {
  return (
    days.find((record) => isOnDay(record, day) && record.slot === slot)
      ?.routineId ?? null
  );
}

export function dayRoutines(
  days: readonly CycleDayRecord[],
  day: GridDay,
): DayRoutines {
  return {
    first: routineInSlot(days, day, 1),
    second: routineInSlot(days, day, 2),
  };
}

/** Lo mismo que hace la base (#904): vaciar la 1 con la 2 puesta sube la 2,
 * y vaciar la 2 la quita. Se pinta antes de que la API responda. */
export function applyDayChange(
  days: readonly CycleDayRecord[],
  change: CycleDayChange,
): readonly CycleDayRecord[] {
  const current = dayRoutines(days, change);
  const next: DayRoutines =
    change.slot === 2
      ? { first: current.first, second: change.routineId }
      : change.routineId === null
        ? { first: current.second, second: null }
        : { first: change.routineId, second: current.second };
  return [
    ...days.filter((record) => !isOnDay(record, change)),
    ...recordsOfDay(change, next),
  ];
}

function recordsOfDay(
  day: GridDay,
  routines: DayRoutines,
): readonly CycleDayRecord[] {
  const { weekNo, weekday } = day;
  if (routines.first === null) {
    return [];
  }
  const first: CycleDayRecord = {
    weekNo,
    weekday,
    slot: 1,
    routineId: routines.first,
  };
  return routines.second === null
    ? [first]
    : [first, { weekNo, weekday, slot: 2, routineId: routines.second }];
}

/** Una semana sin fila en la base no tiene ni nota ni dosis. */
export function weekRecordOf(
  weeks: readonly CycleWeekRecord[],
  weekNo: number,
): CycleWeekRecord {
  return (
    weeks.find((week) => week.weekNo === weekNo) ?? {
      weekNo,
      note: null,
      dose: null,
    }
  );
}

export function canCopyWeekOne(weeks: number): boolean {
  return weeks >= MIN_WEEKS_TO_COPY_WEEK_ONE;
}

/** La última semana a la que llega la semana 1 al copiarla. */
export function lastCopyTarget(weeks: number): number {
  const last = weekOneCopyTargets(weeks).at(-1);
  if (last === undefined) {
    throw new Error(`Un ciclo de ${weeks} semanas no tiene a dónde copiar.`);
  }
  return last;
}

/** La semana que se tiñe: solo la del ciclo activo, y solo mientras corre. */
export function currentGridWeek(cycle: ManagedCycle, now: Date): number | null {
  if (cycle.status !== "active") {
    return null;
  }
  const position = cycleWeekAt(cycle, now);
  return position.phase === "running" ? position.week : null;
}

const FIRST_WEEK = 1;

/** La semana que se abre en el móvil: la de hoy en el activo, o la 1. */
export function initialPhoneWeek(cycle: ManagedCycle, now: Date): number {
  return cycle.status === "active" ? cycleWeekAt(cycle, now).week : FIRST_WEEK;
}

export type IntensityKind = DoseIntensity["kind"];

/** Los campos del editor de la semana, tal como se escriben. */
export type WeekDraft = {
  readonly note: string;
  readonly sets: string;
  readonly reps: string;
  readonly intensityKind: IntensityKind;
  /** El % o el texto, según la intensidad; vacío con `none`. */
  readonly intensityValue: string;
};

export function draftOfWeek(week: CycleWeekRecord): WeekDraft {
  const { dose } = week;
  return {
    note: week.note ?? "",
    sets: dose === null || dose.sets === null ? "" : String(dose.sets),
    reps: dose?.reps ?? "",
    intensityKind: dose?.intensity.kind ?? "none",
    intensityValue: intensityValueOf(dose),
  };
}

function intensityValueOf(dose: WeekDose | null): string {
  if (dose === null) {
    return "";
  }
  switch (dose.intensity.kind) {
    case "none":
      return "";
    case "pct":
      return String(dose.intensity.pct);
    case "text":
      return dose.intensity.text;
  }
}

/** Lo que sale de leer el editor: una semana que mandar, nada que mandar
 * todavía (se eligió % o texto y falta escribirlo) o un campo que no vale. */
export type WeekDraftReading =
  | { readonly kind: "ready"; readonly week: CycleWeekRecord }
  | { readonly kind: "incomplete" }
  | { readonly kind: "invalid"; readonly reason: CycleIssueCode };

type IntensityReading =
  | { readonly kind: "ready"; readonly intensity: DoseIntensity }
  | { readonly kind: "incomplete" }
  | { readonly kind: "invalid"; readonly reason: CycleIssueCode };

/** Los decimales con coma, como se escriben en español. */
function parseDecimal(raw: string): number {
  return Number(raw.replace(",", "."));
}

function readIntensity(draft: WeekDraft): IntensityReading {
  const value = draft.intensityValue.trim();
  if (draft.intensityKind === "none") {
    return { kind: "ready", intensity: { kind: "none" } };
  }
  if (value === "") {
    return { kind: "incomplete" };
  }
  if (draft.intensityKind === "text") {
    return { kind: "ready", intensity: { kind: "text", text: value } };
  }
  const pct = parseDecimal(value);
  return Number.isFinite(pct)
    ? { kind: "ready", intensity: { kind: "pct", pct } }
    : { kind: "invalid", reason: "dose_pct_out_of_range" };
}

function textOrNull(raw: string): string | null {
  const text = raw.trim();
  return text === "" ? null : text;
}

export function readWeekDraft(
  weekNo: number,
  draft: WeekDraft,
): WeekDraftReading {
  const rawSets = draft.sets.trim();
  const sets = rawSets === "" ? null : Number(rawSets);
  if (sets !== null && !Number.isInteger(sets)) {
    return { kind: "invalid", reason: "dose_sets_out_of_range" };
  }
  const intensity = readIntensity(draft);
  if (intensity.kind !== "ready") {
    return intensity;
  }
  const reps = textOrNull(draft.reps);
  const isEmptyDose =
    sets === null && reps === null && intensity.intensity.kind === "none";
  return {
    kind: "ready",
    week: {
      weekNo,
      note: textOrNull(draft.note),
      dose: isEmptyDose ? null : { sets, reps, intensity: intensity.intensity },
    },
  };
}
