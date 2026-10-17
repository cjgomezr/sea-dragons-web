import { vi } from "vitest";
import { DARK_SCHEME_QUERY } from "@/lib/theme";

/**
 * Un doble de `matchMedia` para el esquema de color del sistema, que se puede
 * cambiar con la página abierta: `setPrefersDark` avisa a quien escuche
 * `change`, como hace el navegador. Se deshace con `vi.unstubAllGlobals()`.
 */

export type ColorSchemeControl = {
  readonly setPrefersDark: (prefersDark: boolean) => void;
  readonly listenerCount: () => number;
};

export function stubColorScheme(initiallyDark: boolean): ColorSchemeControl {
  let prefersDark = initiallyDark;
  const listeners = new Set<() => void>();

  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches(): boolean {
      return query === DARK_SCHEME_QUERY && prefersDark;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
    dispatchEvent: () => false,
  }));

  return {
    setPrefersDark(next: boolean): void {
      prefersDark = next;
      listeners.forEach((listener) => listener());
    },
    listenerCount: () => listeners.size,
  };
}
