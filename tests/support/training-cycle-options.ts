import type {
  ActiveTrainingPlan,
  ActiveTrainingPlanWithCycles,
  TrainingCycle,
  TrainingCycleOption,
} from "@/lib/training/training-plan";

/**
 * La lista de ciclos que la API manda con el plan (#979) y la pantalla usa
 * para el selector (#981). Las pruebas que no miran el selector sirven el
 * plan con su propio ciclo como único de la lista.
 */

export function cycleOption(
  cycle: Pick<TrainingCycle, "id" | "name">,
  current: TrainingCycleOption["current"] = {
    week: 1,
    phase: "running",
    today: "2026-10-27",
  },
): TrainingCycleOption {
  return {
    id: cycle.id,
    name: cycle.name,
    current,
    audience: { kind: "club" },
  };
}

/** El plan con su ciclo como el único que ve el socio. */
export function withOnlyItsCycle(
  plan: ActiveTrainingPlan,
): ActiveTrainingPlanWithCycles {
  return { ...plan, cycles: [cycleOption(plan.cycle, plan.current)] };
}

/** La cuenta con la que se pinta Entrenamiento, para la elección guardada. */
export const TRAINING_USER_ID = "aaaaaaaa-0000-4000-8000-0000000000a1";
