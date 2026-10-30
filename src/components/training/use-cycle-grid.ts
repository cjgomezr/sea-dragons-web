"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CycleDayChange,
  CycleDayRecord,
  CycleWeekRecord,
  ManagedCycle,
} from "@/lib/training/club-cycles";
import type { ManagedRoutine } from "@/lib/training/club-routines";
import { applyDayChange } from "@/lib/training/cycle-grid-view";
import {
  type CyclePlan,
  type PlannerFailure,
  clearCycleWeek,
  copyCycleWeekOne,
  loadCyclePlan,
  loadCycleRoutines,
  saveCycleWeek,
  setCycleDay,
} from "./planner-client";
import type { PlannerCycles } from "./use-planner-cycles";

/**
 * La cuadrícula de un ciclo (#907): sus semanas, sus días y las rutinas que
 * se pueden elegir. Un día se pinta al elegirlo y vuelve atrás si la API no
 * lo guarda; la nota, la dosis, la copia de la semana 1 y vaciar una semana
 * (#943) esperan a la API.
 */

export type CycleGridState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly plan: CyclePlan;
      readonly routines: readonly ManagedRoutine[];
    };

export type CycleGrid = {
  readonly state: CycleGridState;
  readonly isCopying: boolean;
  readonly retry: () => void;
  readonly setDay: (change: CycleDayChange) => void;
  /** Verdadero si se guardó. */
  readonly saveWeek: (week: CycleWeekRecord) => Promise<boolean>;
  readonly copyWeekOne: () => Promise<boolean>;
  /** Verdadero si se vació. */
  readonly clearWeek: (weekNo: number) => Promise<boolean>;
};

/** Lo que la cuadrícula le pide a Planificar: decir un fallo. */
export type GridReporter = Pick<PlannerCycles, "showError">;

function isOnDay(record: CycleDayRecord, day: CycleDayChange): boolean {
  return record.weekNo === day.weekNo && record.weekday === day.weekday;
}

/** Devuelve un día a lo que tenía, sin tocar los demás. */
function restoreDay(
  days: readonly CycleDayRecord[],
  previous: readonly CycleDayRecord[],
  day: CycleDayChange,
): readonly CycleDayRecord[] {
  return [
    ...days.filter((record) => !isOnDay(record, day)),
    ...previous.filter((record) => isOnDay(record, day)),
  ];
}

/** Lo que queda al bajar las semanas: lo de las que sobran se fue con ellas
 * en la base, y no debe volver si se suben otra vez. */
function prunePlan(plan: CyclePlan, weeks: number): CyclePlan {
  return {
    weeks: plan.weeks.filter((week) => week.weekNo <= weeks),
    days: plan.days.filter((day) => day.weekNo <= weeks),
  };
}

function useGridLoad(cycleId: string): {
  readonly state: CycleGridState;
  readonly setState: (
    update: (state: CycleGridState) => CycleGridState,
  ) => void;
  readonly retry: () => void;
} {
  const [state, setState] = useState<CycleGridState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void Promise.all([loadCyclePlan(cycleId), loadCycleRoutines(cycleId)]).then(
      ([plan, routines]) => {
        if (!isCurrent) {
          return;
        }
        setState(
          plan.kind === "ok" && routines.kind === "ok"
            ? { kind: "ready", plan: plan.value, routines: routines.value }
            : { kind: "failed" },
        );
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [cycleId, attempt]);

  return {
    state,
    setState,
    retry: () => {
      setState({ kind: "loading" });
      setAttempt((previous) => previous + 1);
    },
  };
}

function updatePlan(
  update: (plan: CyclePlan) => CyclePlan,
): (state: CycleGridState) => CycleGridState {
  return (state) =>
    state.kind === "ready" ? { ...state, plan: update(state.plan) } : state;
}

/** Quita lo de las semanas que ya no están, en el render que las ve irse. */
function usePrunedState(
  state: CycleGridState,
  setState: (update: (state: CycleGridState) => CycleGridState) => void,
  weeks: number,
): void {
  const [prunedWeeks, setPrunedWeeks] = useState(weeks);
  if (weeks === prunedWeeks) {
    return;
  }
  setPrunedWeeks(weeks);
  if (weeks < prunedWeeks && state.kind === "ready") {
    setState(updatePlan((plan) => prunePlan(plan, weeks)));
  }
}

export function useCycleGrid(
  cycle: ManagedCycle,
  reporter: GridReporter,
): CycleGrid {
  const load = useGridLoad(cycle.id);
  const { state, setState } = load;
  usePrunedState(state, setState, cycle.weeks);
  const [isCopying, setIsCopying] = useState(false);
  // Cuántos días esperan a la API: la respuesta de uno no pisa lo que otro
  // ya pintó, así que los días del servidor entran solo con el último.
  const pendingDays = useRef(0);

  function report(failure: PlannerFailure): void {
    reporter.showError({ reason: failure.reason });
  }

  async function setDay(change: CycleDayChange): Promise<void> {
    if (state.kind !== "ready") {
      return;
    }
    reporter.showError(null);
    const previous = state.plan.days;
    setState(
      updatePlan((plan) => ({
        ...plan,
        days: applyDayChange(plan.days, change),
      })),
    );
    pendingDays.current += 1;
    const outcome = await setCycleDay(cycle.id, change);
    pendingDays.current -= 1;
    if (outcome.kind === "failed") {
      report(outcome);
      setState(
        updatePlan((plan) => ({
          ...plan,
          days: restoreDay(plan.days, previous, change),
        })),
      );
      return;
    }
    if (pendingDays.current === 0) {
      setState(updatePlan((plan) => ({ ...plan, days: outcome.value.days })));
    }
  }

  async function saveWeek(week: CycleWeekRecord): Promise<boolean> {
    reporter.showError(null);
    const outcome = await saveCycleWeek(cycle.id, week);
    if (outcome.kind === "failed") {
      report(outcome);
      return false;
    }
    setState(updatePlan((plan) => ({ ...plan, weeks: outcome.value.weeks })));
    return true;
  }

  async function copyWeekOne(): Promise<boolean> {
    reporter.showError(null);
    setIsCopying(true);
    const outcome = await copyCycleWeekOne(cycle.id);
    setIsCopying(false);
    if (outcome.kind === "failed") {
      report(outcome);
      return false;
    }
    setState(updatePlan(() => outcome.value));
    return true;
  }

  async function clearWeek(weekNo: number): Promise<boolean> {
    reporter.showError(null);
    const outcome = await clearCycleWeek(cycle.id, weekNo);
    if (outcome.kind === "failed") {
      report(outcome);
      return false;
    }
    setState(updatePlan(() => outcome.value));
    return true;
  }

  return {
    state,
    isCopying,
    retry: load.retry,
    setDay: (change) => void setDay(change),
    saveWeek,
    copyWeekOne,
    clearWeek,
  };
}
