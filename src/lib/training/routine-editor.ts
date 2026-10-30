import type { ManagedCycle } from "./club-cycles";
import type {
  LastDose,
  RoutineEditorItem,
  RoutineExerciseSummary,
} from "./club-routines";
import { sortCycles } from "./cycle-planner-view";
import {
  ITEM_SETS_MAX,
  ITEM_SETS_MIN,
  LOAD_PCT_MAX,
  type RoutineItemDraft,
  type RoutineLoadDraft,
} from "./routine-items";

/**
 * Lo que el editor de rutinas de Planificar (#908, RF-9, D9 y D10 del PRD de
 * E35) decide antes de pintar o de guardar. Puro: la pantalla guarda la
 * lista entera con cada cambio, y aquí se arma esa lista.
 */

/** El filtro "Routines of" en las compartidas; si no, es el id de un ciclo. */
export const SHARED_ROUTINES_FILTER = "shared";

/** Una fila con la clave que la sigue al moverla: la API no da ids de fila,
 * porque sustituye la lista entera. */
export type EditorRow =
  | { readonly key: string; readonly kind: "section"; readonly title: string }
  | {
      readonly key: string;
      readonly kind: "exercise";
      readonly exercise: RoutineExerciseSummary;
      readonly sets: number | null;
      readonly reps: string | null;
      readonly rest: string | null;
      readonly note: string | null;
      readonly load: RoutineLoadDraft;
    };

export type ExerciseEditorRow = Extract<EditorRow, { kind: "exercise" }>;

export type MoveDirection = "up" | "down";

/** La opción elegida en el selector de la carga, sin sus números. */
export type LoadOption =
  | { readonly kind: "none" }
  | { readonly kind: "pct"; readonly markId: string }
  | { readonly kind: "week"; readonly markId: string }
  | { readonly kind: "text" };

export type SetsInput =
  | { readonly kind: "value"; readonly value: number | null }
  | { readonly kind: "invalid" };

const LOAD_OPTION_SEPARATOR = ":";
const DIGITS_PATTERN = /^\d+$/;
/** Con punto o coma y un decimal como mucho, como guarda la base. */
const PCT_PATTERN = /^\d+(?:[.,]\d)?$/;

export function toEditorRows(
  items: readonly RoutineEditorItem[],
  makeKey: () => string,
): readonly EditorRow[] {
  return items.map((item) => ({ ...item, key: makeKey() }));
}

export function toItemDrafts(
  rows: readonly EditorRow[],
): readonly RoutineItemDraft[] {
  return rows.map((row) =>
    row.kind === "section"
      ? { kind: "section", title: row.title }
      : {
          kind: "exercise",
          exerciseId: row.exercise.id,
          sets: row.sets,
          reps: row.reps,
          rest: row.rest,
          note: row.note,
          load: row.load,
        },
  );
}

/** Un ejercicio que el club nunca usó entra sin dosis. */
const BLANK_DOSE: LastDose = {
  sets: null,
  reps: null,
  rest: null,
  load: { kind: "none" },
};

/** La fila de un ejercicio que se añade (#909): con la última dosis que el
 * club usó con él, o vacía si nunca lo usó. La nota es de cada fila y no se
 * copia. */
export function newExerciseRow(request: {
  readonly key: string;
  readonly exercise: RoutineExerciseSummary;
  readonly dose: LastDose | null;
}): ExerciseEditorRow {
  const { key, exercise, dose } = request;
  return { key, kind: "exercise", exercise, ...(dose ?? BLANK_DOSE), note: null };
}

/** La lista con la fila un puesto más arriba o más abajo; nula si ya está en
 * ese borde. */
export function moveRow(
  rows: readonly EditorRow[],
  index: number,
  direction: MoveDirection,
): readonly EditorRow[] | null {
  const target = direction === "up" ? index - 1 : index + 1;
  const moving = rows[index];
  const displaced = rows[target];
  if (moving === undefined || displaced === undefined) {
    return null;
  }
  return rows.map((row, position) => {
    if (position === index) {
      return displaced;
    }
    return position === target ? moving : row;
  });
}

export function loadOptionValue(load: RoutineLoadDraft | LoadOption): string {
  return load.kind === "pct" || load.kind === "week"
    ? `${load.kind}${LOAD_OPTION_SEPARATOR}${load.markId}`
    : load.kind;
}

export function parseLoadOption(value: string): LoadOption {
  const [kind, markId] = value.split(LOAD_OPTION_SEPARATOR);
  if ((kind === "none" || kind === "text") && markId === undefined) {
    return { kind };
  }
  if ((kind === "pct" || kind === "week") && markId !== undefined) {
    return { kind, markId };
  }
  throw new Error(`La opción de carga "${value}" no existe.`);
}

/** Vacío es sin series; si no, cifras entre 1 y 99. */
export function parseSets(text: string): SetsInput {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { kind: "value", value: null };
  }
  const value = Number(trimmed);
  return DIGITS_PATTERN.test(trimmed) &&
    value >= ITEM_SETS_MIN &&
    value <= ITEM_SETS_MAX
    ? { kind: "value", value }
    : { kind: "invalid" };
}

/** El porcentaje de una carga "% of", o nulo si no vale. */
export function parseLoadPct(text: string): number | null {
  const trimmed = text.trim();
  if (!PCT_PATTERN.test(trimmed)) {
    return null;
  }
  const pct = Number(trimmed.replace(",", "."));
  return pct > 0 && pct <= LOAD_PCT_MAX ? pct : null;
}

/** El activo y los borradores van sueltos; los archivados, en su grupo. */
export function routineFilterGroups(cycles: readonly ManagedCycle[]): {
  readonly current: readonly ManagedCycle[];
  readonly archived: readonly ManagedCycle[];
} {
  const sorted = sortCycles(cycles);
  return {
    current: sorted.filter((cycle) => cycle.status !== "archived"),
    archived: sorted.filter((cycle) => cycle.status === "archived"),
  };
}

/** Abre en el ciclo que se mira en la pestaña Ciclo; sin ciclos, en las
 * compartidas. */
export function defaultRoutineFilter(selectedCycleId: string | null): string {
  return selectedCycleId ?? SHARED_ROUTINES_FILTER;
}
