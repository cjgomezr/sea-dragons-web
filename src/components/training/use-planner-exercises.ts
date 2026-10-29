"use client";

import { useEffect, useState } from "react";
import { useChangeNotice } from "@/components/groups/use-change-notice";
import type { Translator } from "@/lib/i18n/translator";
import type {
  ExerciseCounts,
  ExerciseSource,
  ManagedExercise,
  ManagedExercises,
} from "@/lib/training/club-exercises";
import { countOfSource } from "@/lib/training/exercise-planner-view";
import type { PlannerOutcome } from "./planner-client";
import {
  createExercise,
  deleteExercise,
  loadExercises,
  updateExercise,
} from "./planner-exercises-client";
import type { PlannerError } from "./use-planner-cycles";

/**
 * Los ejercicios de Planificar (#910): la página de la lista que toca para
 * la búsqueda y la ficha elegidas, y lo que se le hace a uno del club. La
 * biblioteca son unos 800 (D12): se piden de 20 en 20 y la lista crece con
 * Show more. Como las marcas, nada cambia hasta que la API responde.
 */

/** El 409 del nombre repetido (#903): lo dice el campo, no la pestaña. */
export const EXERCISE_NAME_TAKEN_REASON = "exercise_name_taken";

/** No viene de la API: la página siguiente no llegó. */
export const LOAD_MORE_FAILED_REASON = "exercises_load_more_failed";

/** Lo que se espera a que deje de escribir antes de buscar. */
const SEARCH_DELAY_MS = 250;

export type ExerciseFilter = {
  readonly text: string;
  /** Nulo es All. */
  readonly source: ExerciseSource | null;
};

export type ExerciseListState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly exercises: readonly ManagedExercise[];
      readonly counts: ExerciseCounts;
      readonly nextOffset: number | null;
      /** Lo que se buscó: la lista de una búsqueda vieja sigue a la vista
       * mientras llega la nueva. */
      readonly text: string;
      readonly source: ExerciseSource | null;
      /** Si la página siguiente ya se pidió y no llegó. */
      readonly isLoadingMore: boolean;
    };

export type ExerciseActionResult =
  | { readonly kind: "done"; readonly exercise: ManagedExercise | null }
  | { readonly kind: "failed"; readonly reason: string | null };

export type PlannerExercises = {
  readonly state: ExerciseListState;
  readonly filter: ExerciseFilter;
  /** Cuántos hay sin buscar nada, para la pestaña; nulo hasta saberlo. */
  readonly total: number | null;
  readonly notice: string | null;
  readonly error: PlannerError | null;
  readonly isBusy: boolean;
  readonly setText: (text: string) => void;
  readonly setSource: (source: ExerciseSource | null) => void;
  readonly loadMore: () => Promise<void>;
  readonly retry: () => void;
  readonly create: (form: FormData) => Promise<ExerciseActionResult>;
  readonly update: (
    exercise: ManagedExercise,
    form: FormData,
  ) => Promise<ExerciseActionResult>;
  readonly remove: (exercise: ManagedExercise) => Promise<ExerciseActionResult>;
};

function useDebounced<Value>(value: Value, delayMs: number): Value {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

type ReadyExerciseList = Extract<ExerciseListState, { kind: "ready" }>;

type ListQuery = Pick<ReadyExerciseList, "text" | "source">;

function readyState(
  page: ManagedExercises,
  query: ListQuery,
): ReadyExerciseList {
  return { kind: "ready", ...page, ...query, isLoadingMore: false };
}

/** La lista sigue siendo la de esa búsqueda y esa ficha, y esperaba esa
 * página: si no, la página que llega es de una lista que ya no está. */
function isAwaitingPage(
  state: ExerciseListState,
  query: ListQuery & { readonly offset: number },
): state is ReadyExerciseList {
  return (
    state.kind === "ready" &&
    state.text === query.text &&
    state.source === query.source &&
    state.nextOffset === query.offset
  );
}

/** Añade la página que llegó, o sólo deja de esperarla si falló. */
function appendPage(
  state: ExerciseListState,
  query: ListQuery & { readonly offset: number },
  outcome: PlannerOutcome<ManagedExercises>,
): ExerciseListState {
  if (!isAwaitingPage(state, query)) {
    return state;
  }
  if (outcome.kind === "failed") {
    return { ...state, isLoadingMore: false };
  }
  return {
    ...readyState(outcome.value, query),
    exercises: [...state.exercises, ...outcome.value.exercises],
  };
}

/** Sólo una lista sin buscar nada dice cuántos hay en total. */
function totalOf(page: ManagedExercises, text: string): number | null {
  return text === "" ? countOfSource(page.counts, null) : null;
}

function useExerciseList(filter: ExerciseFilter): {
  readonly state: ExerciseListState;
  readonly total: number | null;
  readonly shiftTotal: (delta: number) => void;
  readonly retry: () => void;
  readonly refresh: () => Promise<void>;
  readonly loadMore: () => Promise<PlannerOutcome<ManagedExercises> | null>;
} {
  const text = useDebounced(filter.text.trim(), SEARCH_DELAY_MS);
  const { source } = filter;
  const [state, setState] = useState<ExerciseListState>({ kind: "loading" });
  const [total, setTotal] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadExercises({ text, source, offset: 0 }).then((outcome) => {
      if (!isCurrent) {
        return;
      }
      if (outcome.kind === "ok") {
        setState(readyState(outcome.value, { text, source }));
        setTotal((previous) => totalOf(outcome.value, text) ?? previous);
        return;
      }
      setState({ kind: "failed" });
    });
    return () => {
      isCurrent = false;
    };
  }, [text, source, attempt]);

  return {
    state,
    total,
    shiftTotal: (delta) =>
      setTotal((previous) => (previous === null ? null : previous + delta)),
    retry: () => {
      setState({ kind: "loading" });
      setAttempt((previous) => previous + 1);
    },
    // Sin pasar por "cargando": la lista no se vacía. Si no llega, se queda
    // la que había.
    refresh: async () => {
      const outcome = await loadExercises({ text, source, offset: 0 });
      if (outcome.kind === "ok") {
        setState(readyState(outcome.value, { text, source }));
        setTotal((previous) => totalOf(outcome.value, text) ?? previous);
      }
    },
    // Nulo: no había página que pedir, o ya se estaba pidiendo.
    loadMore: async () => {
      if (
        state.kind !== "ready" ||
        state.nextOffset === null ||
        state.isLoadingMore
      ) {
        return null;
      }
      const query = { text, source, offset: state.nextOffset };
      setState({ ...state, isLoadingMore: true });
      const outcome = await loadExercises(query);
      setState((previous) => appendPage(previous, query, outcome));
      return outcome;
    },
  };
}

export function usePlannerExercises(translate: Translator): PlannerExercises {
  const [filter, setFilter] = useState<ExerciseFilter>({
    text: "",
    source: null,
  });
  const list = useExerciseList(filter);
  const { notice, announce } = useChangeNotice();
  const [error, setError] = useState<PlannerError | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  /** Corre una acción: vuelve a pedir la lista y avisa, o dice el error si
   * no es el del nombre repetido, que lo dice su campo. */
  async function run<Value extends ManagedExercise | null>(
    action: () => Promise<PlannerOutcome<Value>>,
    done: {
      readonly totalDelta: number;
      readonly describe: (value: Value) => string;
    },
  ): Promise<ExerciseActionResult> {
    setIsBusy(true);
    setError(null);
    const outcome = await action();
    setIsBusy(false);
    if (outcome.kind === "failed") {
      if (outcome.reason !== EXERCISE_NAME_TAKEN_REASON) {
        setError({ reason: outcome.reason });
      }
      return outcome;
    }
    list.shiftTotal(done.totalDelta);
    announce(done.describe(outcome.value));
    await list.refresh();
    return { kind: "done", exercise: outcome.value };
  }

  return {
    state: list.state,
    filter,
    total: list.total,
    notice,
    error,
    isBusy,
    setText: (text) => setFilter((previous) => ({ ...previous, text })),
    setSource: (source) => setFilter((previous) => ({ ...previous, source })),
    loadMore: async () => {
      setError(null);
      const outcome = await list.loadMore();
      if (outcome !== null && outcome.kind === "failed") {
        setError({ reason: LOAD_MORE_FAILED_REASON });
      }
    },
    retry: list.retry,
    create: (form) =>
      run(() => createExercise(form), {
        totalDelta: 1,
        describe: (created) =>
          translate("training.exercises.created", { name: created.name }),
      }),
    update: (exercise, form) =>
      run(() => updateExercise(exercise.id, form), {
        totalDelta: 0,
        describe: (saved) =>
          translate("training.exercises.saved", { name: saved.name }),
      }),
    remove: (exercise) =>
      run(() => deleteExercise(exercise.id), {
        totalDelta: -1,
        describe: () =>
          translate("training.exercises.deleted", { name: exercise.name }),
      }),
  };
}
