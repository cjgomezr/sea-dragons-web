"use client";

import { useEffect, useRef, useState } from "react";
import {
  type TeamsFailure,
  autoBalance,
  openBuilder,
  publishSplit,
  saveSplit,
} from "./team-builder-client";
import {
  type Destination,
  type TeamDraft,
  applyBalance,
  hasUnsavedChanges,
  movePlayer,
  settleDraft,
  startDraft,
  swapPlayers,
} from "./team-draft";

/**
 * El reparto abierto de un evento (#402): se pide al elegir el evento, se
 * mueve en memoria y se guarda o se publica entero.
 *
 * Balancear, guardar y publicar no se solapan: un segundo toque mientras uno
 * está en vuelo no manda nada. Se lleva en un `ref` y no en el estado porque
 * dos clics seguidos llegan antes de que React vuelva a pintar. Los botones
 * no se desactivan, que le quitaría el foco a quien usa el teclado.
 */

export type BuilderAction =
  | { readonly kind: "idle" }
  | { readonly kind: "balancing" }
  | { readonly kind: "saving" }
  | { readonly kind: "confirmingPublish" }
  | { readonly kind: "publishing" }
  | { readonly kind: "balanced" }
  | { readonly kind: "saved" }
  | { readonly kind: "published"; readonly notifiedCount: number }
  | { readonly kind: "failed"; readonly failure: TeamsFailure };

/** El último movimiento, para anunciarlo. */
export type LastMove = {
  readonly userId: string;
  readonly destination: Destination;
};

export type BuilderState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: TeamsFailure }
  | {
      readonly kind: "ready";
      readonly draft: TeamDraft;
      readonly action: BuilderAction;
      readonly lastMove: LastMove | null;
    };

type ReadyState = Extract<BuilderState, { kind: "ready" }>;

export type TeamBuilderControls = {
  readonly state: BuilderState;
  readonly move: (userId: string, destination: Destination) => void;
  readonly swap: (fromA: string, fromB: string) => void;
  readonly chooseManual: () => void;
  readonly balance: () => Promise<void>;
  readonly save: () => Promise<void>;
  readonly askToPublish: () => void;
  readonly cancelPublish: () => void;
  readonly publish: () => Promise<void>;
  readonly retry: () => void;
};

const IN_FLIGHT: ReadonlySet<BuilderAction["kind"]> = new Set([
  "balancing",
  "saving",
  "publishing",
]);

/** Tocar el reparto borra el aviso de lo último que pasó, salvo que algo
 * siga en vuelo o esté esperando la confirmación. */
function actionAfterEdit(action: BuilderAction): BuilderAction {
  return IN_FLIGHT.has(action.kind) || action.kind === "confirmingPublish"
    ? action
    : { kind: "idle" };
}

function useOpenedDraft(eventId: string): {
  readonly state: BuilderState;
  readonly update: (change: (ready: ReadyState) => ReadyState) => void;
  readonly retry: () => void;
} {
  const [state, setState] = useState<BuilderState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void openBuilder(eventId).then((outcome) => {
      if (isCurrent) {
        setState(
          outcome.kind === "loaded"
            ? {
                kind: "ready",
                draft: startDraft(outcome.builder),
                action: { kind: "idle" },
                lastMove: null,
              }
            : { kind: "failed", failure: outcome },
        );
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [eventId, reloads]);

  function update(change: (ready: ReadyState) => ReadyState): void {
    setState((current) =>
      current.kind === "ready" ? change(current) : current,
    );
  }

  function retry(): void {
    setState({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  return { state, update, retry };
}

export function useTeamBuilder(eventId: string): TeamBuilderControls {
  const { state, update, retry } = useOpenedDraft(eventId);
  const isBusyRef = useRef(false);

  function setAction(action: BuilderAction): void {
    update((ready) => ({ ...ready, action }));
  }

  function fail(failure: TeamsFailure): void {
    setAction({ kind: "failed", failure });
  }

  /** Corre una petición si no hay otra en vuelo. */
  async function exclusively(run: () => Promise<void>): Promise<void> {
    if (state.kind !== "ready" || isBusyRef.current) {
      return;
    }
    isBusyRef.current = true;
    try {
      await run();
    } finally {
      isBusyRef.current = false;
    }
  }

  function move(userId: string, destination: Destination): void {
    update((ready) => ({
      ...ready,
      draft: movePlayer(ready.draft, userId, destination),
      action: actionAfterEdit(ready.action),
      lastMove: { userId, destination },
    }));
  }

  function swap(fromA: string, fromB: string): void {
    update((ready) => ({
      ...ready,
      draft: swapPlayers(ready.draft, fromA, fromB),
      action: actionAfterEdit(ready.action),
      lastMove: { userId: fromA, destination: "b" },
    }));
  }

  function chooseManual(): void {
    update((ready) => ({
      ...ready,
      draft: { ...ready.draft, mode: "manual" },
    }));
  }

  const balance = (): Promise<void> =>
    exclusively(async () => {
      setAction({ kind: "balancing" });
      const outcome = await autoBalance(eventId);
      if (outcome.kind !== "balanced") {
        fail(outcome);
        return;
      }
      update((ready) => ({
        ...ready,
        draft: applyBalance(ready.draft, outcome.split),
        action: { kind: "balanced" },
        lastMove: null,
      }));
    });

  /** Guarda lo que hay ahora. Devuelve si quedó guardado. */
  async function saveCurrent(draft: TeamDraft): Promise<boolean> {
    const sent = draft.assignments;
    const outcome = await saveSplit(eventId, {
      teams: draft.teams,
      assignments: sent,
    });
    if (outcome.kind !== "saved") {
      fail(outcome);
      return false;
    }
    update((ready) => ({ ...ready, draft: settleDraft(ready.draft, sent) }));
    return true;
  }

  const save = (): Promise<void> =>
    exclusively(async () => {
      if (state.kind !== "ready") {
        return;
      }
      setAction({ kind: "saving" });
      if (await saveCurrent(state.draft)) {
        setAction({ kind: "saved" });
      }
    });

  const publish = (): Promise<void> =>
    exclusively(async () => {
      if (state.kind !== "ready") {
        return;
      }
      setAction({ kind: "publishing" });
      if (hasUnsavedChanges(state.draft) && !(await saveCurrent(state.draft))) {
        return;
      }
      const outcome = await publishSplit(eventId);
      if (outcome.kind !== "published") {
        fail(outcome);
        return;
      }
      update((ready) => ({
        ...ready,
        draft: { ...ready.draft, publishedAt: outcome.publishedAt },
        action: { kind: "published", notifiedCount: outcome.notifiedCount },
      }));
    });

  function askToPublish(): void {
    if (!isBusyRef.current) {
      setAction({ kind: "confirmingPublish" });
    }
  }

  function cancelPublish(): void {
    setAction({ kind: "idle" });
  }

  return {
    state,
    move,
    swap,
    chooseManual,
    balance,
    save,
    askToPublish,
    cancelPublish,
    publish,
    retry,
  };
}
