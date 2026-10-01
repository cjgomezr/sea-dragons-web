"use client";

import { useEffect, useState } from "react";
import type { SearchResults } from "@/lib/search/search";
import { SEARCH_TEXT_MIN_LENGTH } from "@/lib/search/search-limits";
import { fetchSearchResults } from "./search-client";

/**
 * Lo que escribe quien busca y lo que respondió la API (#427).
 *
 * Se pide cuando pasan 300 ms sin teclear y hay al menos dos caracteres; cada
 * tecla cancela la espera y la petición que ya estaba en camino, así que sólo
 * la última respuesta llega a la pantalla.
 */

/** Más que los 250 del directorio: aquí cada petición busca en tres sitios, y
 * la lista sale en un desplegable que tapa la pantalla si parpadea. */
const SEARCH_DEBOUNCE_MS = 300;

export type GlobalSearchState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly text: string }
  | { readonly kind: "failed"; readonly text: string }
  | {
      readonly kind: "found";
      readonly text: string;
      readonly results: SearchResults;
    };

/** Lo que respondió la API, apuntado con el texto que se preguntó: una
 * respuesta de otro texto no vale para el que hay ahora. */
type Answer = Exclude<GlobalSearchState, { kind: "idle" | "loading" }>;

/** El texto tal como se manda, o `null` si todavía no es una búsqueda. Se
 * cuentan caracteres y no unidades de UTF-16, como el servidor. */
function searchableText(text: string): string | null {
  const trimmed = text.trim();
  return [...trimmed].length < SEARCH_TEXT_MIN_LENGTH ? null : trimmed;
}

export type GlobalSearch = {
  readonly text: string;
  readonly state: GlobalSearchState;
  readonly setText: (text: string) => void;
  readonly retry: () => void;
};

export function useGlobalSearch(): GlobalSearch {
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  // Reintentar es una petición más del mismo texto: el número la dispara.
  const [attempt, setAttempt] = useState(0);
  const query = searchableText(text);

  useEffect(() => {
    if (query === null) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetchSearchResults(query, controller.signal).then((outcome) => {
        if (!controller.signal.aborted) {
          setAnswer({ ...outcome, text: query });
        }
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, attempt]);

  function retry(): void {
    setAnswer(null);
    setAttempt((count) => count + 1);
  }

  return { text, state: stateOf(query, answer), setText, retry };
}

function stateOf(
  query: string | null,
  answer: Answer | null,
): GlobalSearchState {
  if (query === null) {
    return { kind: "idle" };
  }
  return answer !== null && answer.text === query
    ? answer
    : { kind: "loading", text: query };
}
