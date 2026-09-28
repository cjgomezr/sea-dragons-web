"use client";

import { useEffect, useRef, useState } from "react";
import type {
  AttendanceStatus,
  AttendanceTotals,
} from "@/lib/attendance/attendance-status";
import {
  type AttendanceFailure,
  type OpenedSheet,
  openSheet,
  saveSheet,
} from "./attendance-client";
import {
  type SheetMarks,
  markMember,
  settleMarks,
  startMarks,
} from "./attendance-marks";

/**
 * La hoja abierta de una sesión (#395): se pide al elegir la sesión, se marca
 * sin guardar y se guarda entera.
 *
 * Un segundo toque en "Guardar" mientras guarda no manda nada: se lleva en un
 * `ref` y no en el estado porque dos clics seguidos llegan antes de que React
 * vuelva a pintar. El botón no se desactiva, que le quitaría el foco a quien
 * guarda con el teclado.
 */

export type SaveState =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved"; readonly totals: AttendanceTotals }
  | { readonly kind: "failed"; readonly failure: AttendanceFailure };

export type SheetState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: AttendanceFailure }
  | {
      readonly kind: "ready";
      readonly sheet: OpenedSheet;
      readonly marks: SheetMarks;
      readonly save: SaveState;
    };

export type AttendanceSheetControls = {
  readonly state: SheetState;
  readonly mark: (userId: string, status: AttendanceStatus) => void;
  readonly save: () => Promise<void>;
  readonly retry: () => void;
};

function toReadyState(sheet: OpenedSheet): SheetState {
  return {
    kind: "ready",
    sheet,
    marks: startMarks(
      sheet.members.map(({ userId, status }) => ({ userId, status })),
    ),
    save: { kind: "idle" },
  };
}

export function useAttendanceSheet(eventId: string): AttendanceSheetControls {
  const [state, setState] = useState<SheetState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);
  const isSavingRef = useRef(false);

  useEffect(() => {
    let isCurrent = true;
    void openSheet(eventId).then((outcome) => {
      if (isCurrent) {
        setState(
          outcome.kind === "loaded"
            ? toReadyState(outcome.sheet)
            : { kind: "failed", failure: outcome },
        );
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [eventId, reloads]);

  function mark(userId: string, status: AttendanceStatus): void {
    setState((current) =>
      current.kind === "ready"
        ? {
            ...current,
            marks: markMember(current.marks, { userId, status }),
            save:
              current.save.kind === "saving" ? current.save : { kind: "idle" },
          }
        : current,
    );
  }

  async function save(): Promise<void> {
    if (state.kind !== "ready" || isSavingRef.current) {
      return;
    }
    isSavingRef.current = true;
    const sent = state.marks.current;
    setState((current) =>
      current.kind === "ready"
        ? { ...current, save: { kind: "saving" } }
        : current,
    );
    const outcome = await saveSheet(eventId, sent);
    isSavingRef.current = false;
    setState((current) => {
      if (current.kind !== "ready" || current.sheet.eventId !== eventId) {
        return current;
      }
      return outcome.kind === "saved"
        ? {
            ...current,
            marks: settleMarks(current.marks, sent),
            save: { kind: "saved", totals: outcome.totals },
          }
        : { ...current, save: { kind: "failed", failure: outcome } };
    });
  }

  function retry(): void {
    setState({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  return { state, mark, save, retry };
}
