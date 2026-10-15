import { useMemo, useSyncExternalStore } from "react";

/**
 * Un doble de `useSearchParams` de `next/navigation` para Vitest, atado a
 * `window.location` como lo deja el router de verdad: `pushState`,
 * `replaceState` y el atrás del navegador (`popstate`) lo vuelven a pintar.
 * Se usa con `vi.mock("next/navigation", ...)`.
 */

const LOCATION_CHANGED = "test:location-changed";

function notifyingHistoryMethod(
  method: History["pushState"],
): History["pushState"] {
  return (...args) => {
    method.apply(window.history, args);
    window.dispatchEvent(new Event(LOCATION_CHANGED));
  };
}

window.history.pushState = notifyingHistoryMethod(window.history.pushState);
window.history.replaceState = notifyingHistoryMethod(
  window.history.replaceState,
);

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(LOCATION_CHANGED, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(LOCATION_CHANGED, onChange);
  };
}

function readSearch(): string {
  return window.location.search;
}

export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, readSearch);
  return useMemo(() => new URLSearchParams(search), [search]);
}

/** Deja la dirección en `path` antes de pintar. */
export function visit(path: string): void {
  window.history.replaceState(null, "", path);
}
