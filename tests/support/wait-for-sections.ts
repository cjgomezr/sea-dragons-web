import type { Page } from "@playwright/test";
import { isTimeout } from "./wait-for-hydration";

/** Lo que le damos a cada sección para cargar. Igual que el plazo de un
 * `expect` en CI: si tarda más, algo está roto y no es lentitud. */
export const SECTION_LOAD_TIMEOUT_MS = 15_000;

/** Cómo empieza cada indicador de carga de la aplicación, en los dos
 * idiomas: "Loading the positions…", "Cargando las posiciones…". */
const LOADING_PREFIXES: readonly string[] = ["Loading", "Cargando"];

/** Lo único del `page` de Playwright que hace falta para esperar. */
export type SectionsPage = Pick<Page, "waitForFunction">;

type LoadedCheck = {
  /** El título de la sección, o null para mirar la página entera. */
  readonly heading: string | null;
  readonly loadingPrefixes: readonly string[];
};

/** Corre en el navegador: la sección está a la vista y ya no dice que
 * carga. Sin título mira la página entera. */
function isLoaded({ heading, loadingPrefixes }: LoadedCheck): boolean {
  const title =
    heading === null
      ? null
      : Array.from(document.querySelectorAll("h1, h2, h3")).find(
          (element) => element.textContent?.trim() === heading,
        );
  if (title === undefined) {
    return false;
  }
  const scope =
    title === null
      ? document.body
      : (title.closest("section") ?? title.parentElement ?? document.body);
  return Array.from(scope.querySelectorAll("p, [role='status']")).every(
    (element) => {
      const text = element.textContent?.trim() ?? "";
      return !loadingPrefixes.some((prefix) => text.startsWith(prefix));
    },
  );
}

async function waitUntilLoaded(
  page: SectionsPage,
  heading: string | null,
): Promise<void> {
  try {
    await page.waitForFunction(
      isLoaded,
      { heading, loadingPrefixes: LOADING_PREFIXES },
      { timeout: SECTION_LOAD_TIMEOUT_MS },
    );
  } catch (error) {
    if (!isTimeout(error)) {
      throw error;
    }
    const what = heading === null ? "La página" : `La sección "${heading}"`;
    throw new Error(
      `${what} no terminó de cargar en ${SECTION_LOAD_TIMEOUT_MS} ms.`,
      { cause: error },
    );
  }
}

/**
 * Espera a que estén todas las secciones que se nombran y a que no quede
 * ningún indicador de carga en la página.
 *
 * Una pantalla que carga por partes (la configuración del club: textos de
 * entrada, posiciones, packs) se puede fotografiar con unas secciones
 * cargadas y otras todavía en "Loading…", según lo que tarde cada petición
 * (#561). Si una no llega, el test falla nombrándola en vez de capturar a
 * medias.
 */
export async function waitForSectionsLoaded(
  page: SectionsPage,
  headings: readonly string[],
): Promise<void> {
  for (const heading of headings) {
    await waitUntilLoaded(page, heading);
  }
  await waitUntilLoaded(page, null);
}
