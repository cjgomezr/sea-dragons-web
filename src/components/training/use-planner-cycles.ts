"use client";

import { useEffect, useState } from "react";
import { useChangeNotice } from "@/components/groups/use-change-notice";
import type { Translator } from "@/lib/i18n/translator";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import type { CycleChanges, ManagedCycle } from "@/lib/training/club-cycles";
import {
  defaultCycleId,
  newCycleInput,
  sortCycles,
} from "@/lib/training/cycle-planner-view";
import {
  type CycleList,
  type PlannerOutcome,
  activateCycle,
  archiveCycle,
  createCycle,
  duplicateCycle,
  loadCycles,
  updateCycle,
} from "./planner-client";

/**
 * Los ciclos de Planificar (#906): la lista, el elegido, y lo que se les
 * hace. Nada cambia hasta que la API responde: la lista que se pinta es
 * siempre la última que dio el servidor.
 */

export type PlannerCyclesState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly cycles: CycleList;
      readonly selectedId: string | null;
    };

/** Lo que pasa al guardar un campo. */
export type CycleSaveResult =
  | { readonly kind: "saved" }
  | { readonly kind: "failed" }
  | { readonly kind: "confirmRemoval"; readonly daysRemoved: number };

/** El motivo de un fallo: el `reason` de la API, o nulo si no lo trae. */
export type PlannerError = { readonly reason: string | null };

export type PlannerCycles = {
  readonly state: PlannerCyclesState;
  readonly notice: string | null;
  readonly error: PlannerError | null;
  readonly isBusy: boolean;
  readonly retry: () => void;
  readonly select: (cycleId: string) => void;
  readonly create: () => void;
  readonly save: (request: {
    readonly cycleId: string;
    readonly changes: CycleChanges;
    readonly confirmRemoval: boolean;
  }) => Promise<CycleSaveResult>;
  readonly showError: (error: PlannerError) => void;
  readonly activate: (cycle: ManagedCycle) => void;
  readonly archive: (cycle: ManagedCycle) => void;
  readonly duplicate: (cycle: ManagedCycle) => void;
};

function replaceCycle(cycles: CycleList, cycle: ManagedCycle): CycleList {
  return cycles.map((current) => (current.id === cycle.id ? cycle : current));
}

function useCycleList(): {
  readonly state: PlannerCyclesState;
  readonly setState: (
    update: (state: PlannerCyclesState) => PlannerCyclesState,
  ) => void;
  readonly retry: () => void;
} {
  const [state, setState] = useState<PlannerCyclesState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadCycles().then((outcome) => {
      if (!isCurrent) {
        return;
      }
      setState(
        outcome.kind === "ok"
          ? {
              kind: "ready",
              cycles: sortCycles(outcome.value),
              selectedId: defaultCycleId(outcome.value),
            }
          : { kind: "failed" },
      );
    });
    return () => {
      isCurrent = false;
    };
  }, [attempt]);

  return {
    state,
    setState,
    retry: () => {
      setState({ kind: "loading" });
      setAttempt((previous) => previous + 1);
    },
  };
}

/** Pone una lista nueva y, si se pide, elige otro ciclo. */
function withCycles(
  cycles: CycleList,
  selectedId?: string,
): (state: PlannerCyclesState) => PlannerCyclesState {
  return (state) => ({
    kind: "ready",
    cycles: sortCycles(cycles),
    selectedId:
      selectedId ?? (state.kind === "ready" ? state.selectedId : null),
  });
}

export function usePlannerCycles(translate: Translator): PlannerCycles {
  const list = useCycleList();
  const { notice, announce } = useChangeNotice();
  const [error, setError] = useState<PlannerError | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  /** Corre una acción sobre la lista: avisa si sale y dice el error si no. */
  async function run<Value>(
    action: () => Promise<PlannerOutcome<Value>>,
    onDone: (value: Value) => void,
  ): Promise<void> {
    setIsBusy(true);
    setError(null);
    const outcome = await action();
    setIsBusy(false);
    if (outcome.kind === "failed") {
      setError({ reason: outcome.reason });
      return;
    }
    onDone(outcome.value);
  }

  return {
    state: list.state,
    notice,
    error,
    isBusy,
    retry: list.retry,
    select: (cycleId) => {
      setError(null);
      list.setState((state) =>
        state.kind === "ready" ? { ...state, selectedId: cycleId } : state,
      );
    },
    create: () => {
      const input = newCycleInput(
        translate("training.manage.newCycleName"),
        clubCalendarDate(new Date()),
      );
      void run(
        () => createCycle(input),
        (cycle) =>
          list.setState((state) =>
            withCycles(
              state.kind === "ready" ? [...state.cycles, cycle] : [cycle],
              cycle.id,
            )(state),
          ),
      );
    },
    save: async ({ cycleId, changes, confirmRemoval }) => {
      setError(null);
      const outcome = await updateCycle(cycleId, { changes, confirmRemoval });
      switch (outcome.kind) {
        case "confirmRemoval":
          return outcome;
        case "failed":
          setError({ reason: outcome.reason });
          return { kind: "failed" };
        case "ok":
          list.setState((state) =>
            state.kind === "ready"
              ? { ...state, cycles: replaceCycle(state.cycles, outcome.value) }
              : state,
          );
          return { kind: "saved" };
      }
    },
    showError: setError,
    activate: (cycle) =>
      void run(
        () => activateCycle(cycle.id),
        (cycles) => {
          list.setState(withCycles(cycles));
          announce(
            translate("training.manage.activated", { name: cycle.name }),
          );
        },
      ),
    archive: (cycle) =>
      void run(
        () => archiveCycle(cycle.id),
        (cycles) => {
          list.setState(withCycles(cycles));
          announce(translate("training.manage.archived", { name: cycle.name }));
        },
      ),
    duplicate: (cycle) =>
      void run(
        () => duplicateCycle(cycle.id),
        (duplicated) => {
          list.setState(
            withCycles(duplicated.cycles, duplicated.duplicatedCycleId),
          );
          announce(
            translate("training.manage.duplicated", {
              count: duplicated.routinesCopied,
            }),
          );
        },
      ),
  };
}
