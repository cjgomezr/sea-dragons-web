"use client";

import { useEffect, useState } from "react";
import type { ManagedExercise } from "@/lib/training/club-exercises";
import { loadExercises } from "./planner-exercises-client";

/**
 * La búsqueda de la fila de añadir de una rutina (#909): pregunta a la API de
 * ejercicios (#903) cuando se deja de escribir y se queda con los primeros.
 * Una respuesta que llega para un texto que ya no está se descarta.
 */

/** Lo que se espera entre teclas antes de buscar. */
const SEARCH_DELAY_MS = 250;

/** Los resultados que caben en el desplegable (§5.1 del handoff). */
const MAX_RESULTS = 6;

export type ExerciseSearchState =
  | { readonly kind: "idle" }
  | { readonly kind: "searching" }
  | { readonly kind: "failed" }
  | { readonly kind: "found"; readonly exercises: readonly ManagedExercise[] };

type SettledSearch = {
  readonly text: string;
  readonly state: Extract<ExerciseSearchState, { kind: "failed" | "found" }>;
};

export function useExerciseSearch(query: string): ExerciseSearchState {
  const text = query.trim();
  const [settled, setSettled] = useState<SettledSearch | null>(null);

  useEffect(() => {
    if (text === "") {
      return;
    }
    let isCurrent = true;
    const timer = setTimeout(() => {
      void loadExercises({ text, source: null, offset: 0 }).then((outcome) => {
        if (!isCurrent) {
          return;
        }
        setSettled({
          text,
          state:
            outcome.kind === "ok"
              ? {
                  kind: "found",
                  exercises: outcome.value.exercises.slice(0, MAX_RESULTS),
                }
              : { kind: "failed" },
        });
      });
    }, SEARCH_DELAY_MS);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [text]);

  if (text === "") {
    return { kind: "idle" };
  }
  return settled !== null && settled.text === text
    ? settled.state
    : { kind: "searching" };
}
