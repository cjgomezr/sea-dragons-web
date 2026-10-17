import { vi } from "vitest";

/**
 * Un doble de `matchMedia` para Vitest, que jsdom no trae: dice si la
 * pantalla es la del móvil, el corte que lee `useIsPhone`. Se deshace con
 * `vi.unstubAllGlobals()`.
 */

const PHONE_QUERY = "(width < 768px)";

export function stubScreenWidth(isPhone: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: isPhone && query === PHONE_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}
