import type { Page } from "@playwright/test";

/** Lo que le damos a React para hidratar la página. Igual que el plazo de un
 * `expect` en CI: si tarda más, algo está roto y no es lentitud. */
export const HYDRATION_TIMEOUT_MS = 15_000;

/** Lo único del `page` de Playwright que hace falta para esperar. */
export type HydrationPage = Pick<Page, "waitForFunction">;

export function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

/**
 * Espera a que React hidrate el primer elemento que casa con `selector`.
 *
 * Antes de hidratar, la página servida ya se ve entera pero nadie la
 * escucha: un `change` o un `click` se pierden, y lo que se cambie a mano en
 * el DOM React lo pisa al hidratar. La marca de que ya llegó es la clave
 * `__reactFiber…` que React deja en cada nodo que gestiona.
 */
export async function waitForHydration(
  page: HydrationPage,
  selector: string,
): Promise<void> {
  try {
    await page.waitForFunction(
      (target) => {
        const element = document.querySelector(target);
        return (
          element !== null &&
          Object.keys(element).some((key) => key.startsWith("__reactFiber"))
        );
      },
      selector,
      { timeout: HYDRATION_TIMEOUT_MS },
    );
  } catch (error) {
    if (!isTimeout(error)) {
      throw error;
    }
    throw new Error(
      `React no hidrató "${selector}" en ${HYDRATION_TIMEOUT_MS} ms.`,
      { cause: error },
    );
  }
}
