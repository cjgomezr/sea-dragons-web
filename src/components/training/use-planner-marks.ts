"use client";

import { useEffect, useState } from "react";
import { useChangeNotice } from "@/components/groups/use-change-notice";
import type { Translator } from "@/lib/i18n/translator";
import type { ManagedMark } from "@/lib/training/club-marks";
import type { PlannerOutcome } from "./planner-client";
import {
  type MarkList,
  createMark,
  deleteMark,
  loadMarks,
  renameMark,
} from "./planner-marks-client";
import type { PlannerError } from "./use-planner-cycles";

/**
 * Las marcas de Planificar (#911): la lista y lo que se le hace. Como los
 * ciclos, nada cambia hasta que la API responde: lo que se pinta es siempre
 * la última lista que dio el servidor.
 */

/** El 409 del nombre repetido (#903): lo dice el campo, no la pestaña. */
export const MARK_NAME_TAKEN_REASON = "mark_name_taken";

/** Los 409 de borrar una marca que cambió desde que se pintó: alguien la
 * puso en una rutina o la registró. Se vuelve a leer la lista para que el
 * siguiente Delete vea lo que hay. */
const STALE_MARK_REASONS: ReadonlySet<string> = new Set([
  "mark_in_use",
  "mark_has_values",
]);

export type PlannerMarksState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly marks: MarkList };

export type MarkActionResult =
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly reason: string | null };

export type PlannerMarks = {
  readonly state: PlannerMarksState;
  readonly notice: string | null;
  readonly error: PlannerError | null;
  readonly isBusy: boolean;
  readonly retry: () => void;
  readonly create: (name: string) => Promise<MarkActionResult>;
  readonly rename: (
    mark: ManagedMark,
    name: string,
  ) => Promise<MarkActionResult>;
  readonly remove: (
    mark: ManagedMark,
    confirm: boolean,
  ) => Promise<MarkActionResult>;
};

function useMarkList(): {
  readonly state: PlannerMarksState;
  readonly setMarks: (marks: MarkList) => void;
  readonly retry: () => void;
  readonly refresh: () => Promise<void>;
} {
  const [state, setState] = useState<PlannerMarksState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadMarks().then((outcome) => {
      if (isCurrent) {
        setState(
          outcome.kind === "ok"
            ? { kind: "ready", marks: outcome.value }
            : { kind: "failed" },
        );
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [attempt]);

  return {
    state,
    setMarks: (marks) => setState({ kind: "ready", marks }),
    retry: () => {
      setState({ kind: "loading" });
      setAttempt((previous) => previous + 1);
    },
    // Sin pasar por "cargando": la pestaña no se vacía. Si no llega, se
    // queda la lista que había, y el error de la acción ya está dicho.
    refresh: async () => {
      const outcome = await loadMarks();
      if (outcome.kind === "ok") {
        setState({ kind: "ready", marks: outcome.value });
      }
    },
  };
}

export function usePlannerMarks(translate: Translator): PlannerMarks {
  const list = useMarkList();
  const { notice, announce } = useChangeNotice();
  const [error, setError] = useState<PlannerError | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  /** Corre una acción: pinta la lista que responde y avisa, o dice el error
   * si no es el del nombre repetido, que lo dice su campo. */
  async function run(
    action: () => Promise<PlannerOutcome<MarkList>>,
    describeDone: () => string,
  ): Promise<MarkActionResult> {
    setIsBusy(true);
    setError(null);
    const outcome = await action();
    setIsBusy(false);
    if (outcome.kind === "failed") {
      if (outcome.reason !== MARK_NAME_TAKEN_REASON) {
        setError({ reason: outcome.reason });
      }
      if (outcome.reason !== null && STALE_MARK_REASONS.has(outcome.reason)) {
        await list.refresh();
      }
      return outcome;
    }
    list.setMarks(outcome.value);
    announce(describeDone());
    return { kind: "done" };
  }

  return {
    state: list.state,
    notice,
    error,
    isBusy,
    retry: list.retry,
    create: (name) =>
      run(
        () => createMark(name),
        () => translate("training.marks.created", { name }),
      ),
    rename: (mark, name) =>
      run(
        () => renameMark(mark.id, name),
        () => translate("training.marks.renamed", { name }),
      ),
    remove: (mark, confirm) =>
      run(
        () => deleteMark(mark.id, confirm),
        () => translate("training.marks.deleted", { name: mark.name }),
      ),
  };
}
