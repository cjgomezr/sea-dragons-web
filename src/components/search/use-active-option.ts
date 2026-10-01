"use client";

import { useState } from "react";
import type { SearchResults } from "@/lib/search/search";

/**
 * La opción que marcan las flechas en la lista de la búsqueda global (#427).
 * El foco se queda en el cuadro: la marcada la dice `aria-activedescendant`,
 * y vale sólo para la respuesta en la que se marcó.
 */

type ActiveOption = {
  readonly results: SearchResults;
  readonly index: number;
};

export type ArrowKey = "ArrowDown" | "ArrowUp";

export function isArrowKey(key: string): key is ArrowKey {
  return key === "ArrowDown" || key === "ArrowUp";
}

/** Sin nada marcado, abajo empieza por el primero y arriba por el último; en
 * los extremos se da la vuelta. */
function nextIndex(
  current: number | null,
  count: number,
  key: ArrowKey,
): number {
  if (current === null) {
    return key === "ArrowDown" ? 0 : count - 1;
  }
  const step = key === "ArrowDown" ? 1 : -1;
  return (current + step + count) % count;
}

export type ActiveOptionControl = {
  readonly activeIndex: number | null;
  /** Marca la siguiente o la anterior y devuelve cuál quedó marcada. */
  readonly move: (key: ArrowKey) => number;
  readonly clear: () => void;
};

export function useActiveOption(
  results: SearchResults | null,
  optionCount: number,
): ActiveOptionControl {
  const [active, setActive] = useState<ActiveOption | null>(null);
  const activeIndex =
    results !== null && active?.results === results ? active.index : null;

  function move(key: ArrowKey): number {
    const index = nextIndex(activeIndex, optionCount, key);
    if (results !== null) {
      setActive({ results, index });
    }
    return index;
  }

  return { activeIndex, move, clear: () => setActive(null) };
}
