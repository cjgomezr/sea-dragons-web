"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ManagedRoutine,
  RoutineEditorItem,
} from "@/lib/training/club-routines";
import {
  type EditorRow,
  toEditorRows,
  toItemDrafts,
} from "@/lib/training/routine-editor";
import {
  type RoutineMark,
  loadMarks,
  loadRoutineEditor,
  renameRoutine,
  saveRoutineItems,
} from "./planner-routines-client";
import type { PlannerError } from "./use-planner-cycles";

/**
 * La rutina abierta en el editor de Planificar → Rutinas (#908): sus filas y
 * las marcas del club que ofrece la carga. Cada cambio se pinta al momento y
 * se guarda la lista entera (#905). El editor se monta de nuevo con cada
 * rutina, así que todo lo de aquí es de una sola.
 *
 * Los guardados van en fila, uno detrás de otro, para que la base los reciba
 * en el orden en que se hicieron. Si uno falla, las filas vuelven a lo último
 * que la base confirmó y los que esperaban detrás se descartan: llevaban el
 * cambio que no entró.
 */

export type RoutineEditorState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly rows: readonly EditorRow[];
      readonly marks: readonly RoutineMark[];
    };

export type RoutineEditorControls = {
  readonly state: RoutineEditorState;
  readonly retry: () => void;
  readonly saveRows: (rows: readonly EditorRow[]) => void;
  /** Verdadero si la API lo guardó. */
  readonly rename: (name: string) => Promise<boolean>;
  /** Una clave nueva para una fila que se añade. */
  readonly makeKey: () => string;
};

type EditorCallbacks = {
  readonly onSaved: (routine: ManagedRoutine) => void;
  readonly onError: (error: PlannerError | null) => void;
};

function useEditorLoad(
  routineId: string,
  toRows: (items: readonly RoutineEditorItem[]) => readonly EditorRow[],
): {
  readonly state: RoutineEditorState;
  readonly setRows: (rows: readonly EditorRow[]) => void;
  readonly retry: () => void;
} {
  const [state, setState] = useState<RoutineEditorState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void Promise.all([loadRoutineEditor(routineId), loadMarks()]).then(
      ([editor, marks]) => {
        if (!isCurrent) {
          return;
        }
        setState(
          editor.kind === "ok" && marks.kind === "ok"
            ? {
                kind: "ready",
                rows: toRows(editor.value.items),
                marks: marks.value,
              }
            : { kind: "failed" },
        );
      },
    );
    return () => {
      isCurrent = false;
    };
    // `toRows` no cambia lo que se pide: pone claves y apunta lo confirmado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routineId, attempt]);

  return {
    state,
    setRows: (rows) =>
      setState((current) =>
        current.kind === "ready" ? { ...current, rows } : current,
      ),
    retry: () => {
      setState({ kind: "loading" });
      setAttempt((previous) => previous + 1);
    },
  };
}

export function useRoutineEditor(
  routineId: string,
  callbacks: EditorCallbacks,
): RoutineEditorControls {
  const nextKey = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** Sube con cada fallo: lo que esperaba en la fila ya no vale. */
  const generation = useRef(0);
  /** Lo último que la base confirmó. */
  const confirmed = useRef<readonly EditorRow[]>([]);

  function makeKey(): string {
    nextKey.current += 1;
    return `row-${nextKey.current}`;
  }

  const editor = useEditorLoad(routineId, (items) => {
    const rows = toEditorRows(items, makeKey);
    confirmed.current = rows;
    return rows;
  });

  async function save(
    rows: readonly EditorRow[],
    savedGeneration: number,
  ): Promise<void> {
    if (savedGeneration !== generation.current) {
      return;
    }
    const outcome = await saveRoutineItems(routineId, toItemDrafts(rows));
    if (outcome.kind === "failed") {
      generation.current += 1;
      editor.setRows(confirmed.current);
      callbacks.onError({ reason: outcome.reason });
      return;
    }
    confirmed.current = rows;
    callbacks.onSaved(outcome.value);
  }

  return {
    state: editor.state,
    retry: editor.retry,
    makeKey,
    saveRows: (rows) => {
      callbacks.onError(null);
      editor.setRows(rows);
      const savedGeneration = generation.current;
      queue.current = queue.current.then(() => save(rows, savedGeneration));
    },
    rename: async (name) => {
      callbacks.onError(null);
      const outcome = await renameRoutine(routineId, name);
      if (outcome.kind === "failed") {
        callbacks.onError({ reason: outcome.reason });
        return false;
      }
      callbacks.onSaved(outcome.value);
      return true;
    },
  };
}
