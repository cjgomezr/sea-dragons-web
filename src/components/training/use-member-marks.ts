"use client";

import { useEffect, useMemo, useState } from "react";
import type { MemberMark } from "@/lib/training/member-marks";
import type { MarkValues } from "@/lib/training/routine-row-view";
import { loadMemberMarks, storeMemberMark } from "./training-client";

/**
 * Las marcas del socio en Entrenamiento (#901): se leen una vez al abrir la
 * pantalla y cada fila que calcula kilos las mira. Guardar una desde una
 * fila cambia la lista entera, así que todas las filas que la usan cambian a
 * la vez.
 */

export type MemberMarksState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "blocked" }
  | { readonly kind: "ready"; readonly marks: readonly MemberMark[] };

export type SaveMark = (
  markId: string,
  value: number | null,
) => Promise<"saved" | "failed">;

function markValuesOf(marks: readonly MemberMark[]): MarkValues {
  return new Map(
    marks.flatMap((mark) =>
      mark.value === null ? [] : [[mark.id, mark.value] as const],
    ),
  );
}

export function useMemberMarks(): {
  readonly state: MemberMarksState;
  readonly markValues: MarkValues;
  readonly saveMark: SaveMark;
  readonly retry: () => void;
} {
  const [state, setState] = useState<MemberMarksState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadMemberMarks().then((outcome) => {
      if (!isCurrent) {
        return;
      }
      setState(
        outcome.kind === "loaded"
          ? { kind: "ready", marks: outcome.marks.marks }
          : { kind: outcome.kind },
      );
    });
    return () => {
      isCurrent = false;
    };
  }, [attempt]);

  const markValues = useMemo(
    () => markValuesOf(state.kind === "ready" ? state.marks : []),
    [state],
  );

  return {
    state,
    markValues,
    saveMark: async (markId, value) => {
      const outcome = await storeMemberMark(markId, value);
      if (outcome.kind !== "loaded") {
        return "failed";
      }
      setState({ kind: "ready", marks: outcome.marks.marks });
      return "saved";
    },
    retry: () => {
      setState({ kind: "loading" });
      setAttempt((previous) => previous + 1);
    },
  };
}
