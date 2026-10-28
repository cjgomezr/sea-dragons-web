"use client";

import { useEffect, useState } from "react";
import type { ManagedRoutine } from "@/lib/training/club-routines";
import { createRoutine, loadRoutines } from "./planner-routines-client";
import type { PlannerError } from "./use-planner-cycles";

/**
 * El filtro "Routines of" y la lista de Planificar → Rutinas (#908): qué
 * rutinas se ven y cuál está abierta. La abierta es siempre una de la
 * lista: si se va, se abre la primera (§5.1 del handoff).
 */

export type RoutineListState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly routines: readonly ManagedRoutine[] };

export type RoutineList = {
  readonly filter: string;
  readonly state: RoutineListState;
  /** La abierta; nula con la lista vacía o sin cargar. */
  readonly selected: ManagedRoutine | null;
  readonly isCreating: boolean;
  readonly changeFilter: (filter: string) => void;
  readonly retry: () => void;
  readonly select: (routineId: string) => void;
  /** La rutina creada y abierta, o nula si la API dijo que no. */
  readonly create: (name: string) => Promise<ManagedRoutine | null>;
  readonly replace: (routine: ManagedRoutine) => void;
  readonly remove: (routineId: string) => void;
};

function useRoutinesOf(filter: string): {
  readonly state: RoutineListState;
  readonly setRoutines: (
    update: (routines: readonly ManagedRoutine[]) => readonly ManagedRoutine[],
  ) => void;
  readonly retry: () => void;
} {
  const [state, setState] = useState<RoutineListState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadRoutines(filter).then((outcome) => {
      if (isCurrent) {
        setState(
          outcome.kind === "ok"
            ? { kind: "ready", routines: outcome.value }
            : { kind: "failed" },
        );
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [filter, attempt]);

  return {
    state,
    setRoutines: (update) =>
      setState((current) =>
        current.kind === "ready"
          ? { kind: "ready", routines: update(current.routines) }
          : current,
      ),
    retry: () => {
      setState({ kind: "loading" });
      setAttempt((previous) => previous + 1);
    },
  };
}

function selectedRoutine(
  state: RoutineListState,
  selectedId: string | null,
): ManagedRoutine | null {
  if (state.kind !== "ready") {
    return null;
  }
  const { routines } = state;
  return (
    routines.find((routine) => routine.id === selectedId) ??
    routines.at(0) ??
    null
  );
}

export function useRoutineList(
  initialFilter: string,
  onError: (error: PlannerError | null) => void,
): RoutineList {
  const [filter, setFilter] = useState(initialFilter);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const list = useRoutinesOf(filter);

  return {
    filter,
    state: list.state,
    selected: selectedRoutine(list.state, selectedId),
    isCreating,
    changeFilter: (next) => {
      onError(null);
      setFilter(next);
      list.retry();
    },
    retry: list.retry,
    select: setSelectedId,
    create: async (name) => {
      setIsCreating(true);
      onError(null);
      const outcome = await createRoutine({ name, filter });
      setIsCreating(false);
      if (outcome.kind === "failed") {
        onError({ reason: outcome.reason });
        return null;
      }
      const routine = outcome.value;
      // Las propias van antes que las compartidas; una nueva, al final de
      // las suyas.
      list.setRoutines((routines) => {
        const own = routines.filter((entry) => entry.cycleId !== null);
        const shared = routines.filter((entry) => entry.cycleId === null);
        return routine.cycleId === null
          ? [...own, ...shared, routine]
          : [...own, routine, ...shared];
      });
      setSelectedId(routine.id);
      return routine;
    },
    replace: (routine) =>
      list.setRoutines((routines) =>
        routines.map((entry) => (entry.id === routine.id ? routine : entry)),
      ),
    remove: (routineId) =>
      list.setRoutines((routines) =>
        routines.filter((entry) => entry.id !== routineId),
      ),
  };
}
