"use client";

import { useEffect, useState } from "react";
import type { ActiveTrainingPlanWithCycles } from "@/lib/training/training-plan";
import {
  browserCycleChoiceStorage,
  forgetCycleChoice,
  readSavedCycleChoice,
  saveCycleChoice,
} from "@/lib/training/saved-cycle-choice";
import { type TrainingPlanBlock, loadTrainingPlan } from "./training-client";

/**
 * El plan que pinta Entrenamiento: qué semana de qué ciclo pedir a la API, y
 * qué hacer cuando se elige otro (#981, D6 y D7 de E38).
 *
 * El ciclo de entrada sale, por orden, del `?cycle` de la URL (un enlace
 * compartido), de la última elección en el dispositivo, o de la API. Uno que
 * ya no ve responde 404: se olvida de donde salió y se pide el de la API, sin
 * enseñar ningún error.
 */

const CYCLE_QUERY_PARAM = "cycle";

export type PlanState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | ({ readonly kind: "blocked" } & TrainingPlanBlock)
  | { readonly kind: "noCycle" }
  | { readonly kind: "ready"; readonly plan: ActiveTrainingPlanWithCycles };

/** De dónde salió el ciclo pedido: lo que hay que olvidar si ya no lo ve.
 * El del selector vive a la vez en el dispositivo y en la URL. */
type CycleSource = "url" | "device" | "picker" | "api";

type PlanRequest = {
  /** Nula es la de hoy. */
  readonly week: number | null;
  /** Nulo es el de entrada que decide la API. */
  readonly cycleId: string | null;
  readonly source: CycleSource;
  readonly attempt: number;
};

function cycleInUrl(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return new URLSearchParams(window.location.search).get(CYCLE_QUERY_PARAM);
}

/** Cambia `?cycle` sin pedir la página otra vez; nulo lo quita. */
function replaceCycleInUrl(cycleId: string | null): void {
  const params = new URLSearchParams(window.location.search);
  if (cycleId === null) {
    params.delete(CYCLE_QUERY_PARAM);
  } else {
    params.set(CYCLE_QUERY_PARAM, cycleId);
  }
  const search = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${search === "" ? "" : `?${search}`}`,
  );
}

function initialRequest(userId: string): PlanRequest {
  const fromUrl = cycleInUrl();
  if (fromUrl !== null) {
    return { week: null, cycleId: fromUrl, source: "url", attempt: 0 };
  }
  const saved = readSavedCycleChoice(browserCycleChoiceStorage(), userId);
  return saved === null
    ? { week: null, cycleId: null, source: "api", attempt: 0 }
    : { week: null, cycleId: saved, source: "device", attempt: 0 };
}

/** Un ciclo pedido que ya no ve deja de pedirse por donde llegó. */
function forgetUnseenCycle(source: CycleSource, userId: string): void {
  switch (source) {
    case "url":
      replaceCycleInUrl(null);
      return;
    case "device":
      forgetCycleChoice(browserCycleChoiceStorage(), userId);
      return;
    case "picker":
      forgetCycleChoice(browserCycleChoiceStorage(), userId);
      replaceCycleInUrl(null);
      return;
    case "api":
      return;
  }
}

/** Al cambiar de semana o de ciclo se sigue viendo el anterior hasta que
 * llega el nuevo. */
export function useTrainingPlan(userId: string): {
  readonly state: PlanState;
  readonly showWeek: (week: number, cycleId: string) => void;
  readonly chooseCycle: (cycleId: string) => void;
  readonly retry: () => void;
} {
  const [state, setState] = useState<PlanState>({ kind: "loading" });
  const [request, setRequest] = useState<PlanRequest>(() =>
    initialRequest(userId),
  );

  useEffect(() => {
    let isCurrent = true;
    void loadTrainingPlan(request).then((outcome) => {
      if (!isCurrent) {
        return;
      }
      switch (outcome.kind) {
        case "cycleNotFound":
          forgetUnseenCycle(request.source, userId);
          setRequest({ ...request, week: null, cycleId: null, source: "api" });
          return;
        case "loaded":
          setState(
            outcome.plan.cycle === null
              ? { kind: "noCycle" }
              : { kind: "ready", plan: outcome.plan },
          );
          return;
        default:
          setState(outcome);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [request, userId]);

  return {
    state,
    showWeek: (week, cycleId) =>
      setRequest((previous) => ({ ...previous, week, cycleId })),
    chooseCycle: (cycleId) => {
      saveCycleChoice(browserCycleChoiceStorage(), { userId, cycleId });
      replaceCycleInUrl(cycleId);
      setRequest((previous) => ({
        week: null,
        cycleId,
        source: "picker",
        attempt: previous.attempt,
      }));
    },
    retry: () => {
      setState({ kind: "loading" });
      setRequest((previous) => ({
        ...previous,
        attempt: previous.attempt + 1,
      }));
    },
  };
}
