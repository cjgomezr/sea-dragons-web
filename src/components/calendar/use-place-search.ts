import { useEffect, useState } from "react";
import {
  PLACE_QUERY_MIN_LENGTH,
  type PlaceSuggestions,
} from "@/lib/events/place-search";
import { searchEventPlaces } from "./event-places-client";

/**
 * Lo que sugiere el buscador de lugares mientras está abierto (#652, D1 del
 * PRD de E24). Con menos de 3 caracteres se piden una sola vez los del club
 * más usados; con más, la búsqueda sale 300 ms después de la última tecla.
 * Cada búsqueda nueva aborta la anterior, y lo que ésta responda tarde se
 * descarta: nunca pisa la última.
 */

/** La espera entre teclas de D1: no se busca a cada letra. */
export const PLACE_SEARCH_DELAY_MS = 300;

export type PlaceSearchState =
  | { readonly kind: "waiting" }
  | { readonly kind: "found"; readonly suggestions: PlaceSuggestions }
  | { readonly kind: "failed" };

/** Lo que se busca: vacío pide los del club más usados. */
function searchQueryOf(text: string): string {
  const trimmed = text.trim();
  return [...trimmed].length < PLACE_QUERY_MIN_LENGTH ? "" : trimmed;
}

export function usePlaceSearch(
  text: string,
  isSearching: boolean,
): PlaceSearchState {
  const [state, setState] = useState<PlaceSearchState>({ kind: "waiting" });
  const query = searchQueryOf(text);

  useEffect(() => {
    if (!isSearching) {
      return;
    }
    const controller = new AbortController();
    async function search(): Promise<void> {
      const outcome = await searchEventPlaces(query, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      // Un fallo no se reintenta: el campo sigue aceptando texto libre y los
      // lugares del club, como cuando Photon no está (RF-5).
      setState(outcome.kind === "found" ? outcome : { kind: "failed" });
    }
    const timer = window.setTimeout(
      () => void search(),
      query === "" ? 0 : PLACE_SEARCH_DELAY_MS,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, isSearching]);

  return state;
}
