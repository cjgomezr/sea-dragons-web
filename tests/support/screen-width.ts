import { vi } from "vitest";

/**
 * Un doble de `matchMedia` para Vitest, que jsdom no trae: dice si la
 * pantalla es la del móvil, el corte que lee `useIsPhone`. Se deshace con
 * `vi.unstubAllGlobals()`.
 */

const PHONE_QUERY = "(width < 768px)";
const BELOW_DESKTOP_QUERY = "(width < 1024px)";

/** Los anchos que distinguen las pantallas: el móvil está también por
 * debajo del escritorio, como en un navegador de verdad. */
export type ScreenSize = "phone" | "tablet" | "desktop";

function stubMatches(matches: (query: string) => boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

export function stubScreenWidth(isPhone: boolean): void {
  stubMatches((query) => isPhone && query === PHONE_QUERY);
}

export function stubScreenSize(size: ScreenSize): void {
  stubMatches(
    (query) =>
      (query === PHONE_QUERY && size === "phone") ||
      (query === BELOW_DESKTOP_QUERY && size !== "desktop"),
  );
}
