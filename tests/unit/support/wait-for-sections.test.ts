import { afterEach, describe, expect, it } from "vitest";
import {
  SECTION_LOAD_TIMEOUT_MS,
  type SectionsPage,
  waitForSectionsLoaded,
} from "../../support/wait-for-sections";

const POSITIONS = "Positions";
const SESSION_PACKS = "Session packs";
/** Las vueltas que da el `page` fingido antes de rendirse, como haría
 * Playwright al agotar el plazo. */
const FAKE_POLLS = 20;

type WaitOptions = { readonly timeout?: number };

/** Un `page` que evalúa la condición sobre el DOM de jsdom, vuelta a vuelta,
 * y se rinde como Playwright con un `TimeoutError` si nunca se cumple. */
function fakePage(): SectionsPage & { readonly timeouts: number[] } {
  const timeouts: number[] = [];
  const page = {
    timeouts,
    async waitForFunction<Arg>(
      condition: (arg: Arg) => boolean,
      arg: Arg,
      options?: WaitOptions,
    ) {
      timeouts.push(options?.timeout ?? Number.NaN);
      for (let poll = 0; poll < FAKE_POLLS; poll += 1) {
        if (condition(arg)) {
          return;
        }
        await nextTick();
      }
      const timeout = new Error("page.waitForFunction: Timeout exceeded.");
      timeout.name = "TimeoutError";
      throw timeout;
    },
  };
  // El de verdad devuelve un `JSHandle`; `waitForSectionsLoaded` no lo usa.
  return page as unknown as SectionsPage & { readonly timeouts: number[] };
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Una sección como las de la configuración del club: su título y, mientras
 * carga, el párrafo que lo dice. */
function addSection(heading: string, loadingText: string | null): Element {
  const section = document.createElement("section");
  const title = document.createElement("h2");
  title.textContent = heading;
  section.append(title);
  if (loadingText !== null) {
    const loading = document.createElement("p");
    loading.textContent = loadingText;
    section.append(loading);
  }
  document.body.append(section);
  return section;
}

function finishLoading(section: Element): void {
  section.querySelector("p")?.replaceWith(document.createElement("ul"));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("waitForSectionsLoaded (#561)", () => {
  it("resuelve cuando todas las secciones ya cargaron", async () => {
    addSection(POSITIONS, null);
    addSection(SESSION_PACKS, null);

    await expect(
      waitForSectionsLoaded(fakePage(), [POSITIONS, SESSION_PACKS]),
    ).resolves.toBeUndefined();
  });

  it("espera a que desaparezca el indicador de carga de una sección", async () => {
    addSection(POSITIONS, null);
    const packs = addSection(SESSION_PACKS, "Loading the session packs…");
    const waiting = waitForSectionsLoaded(fakePage(), [
      POSITIONS,
      SESSION_PACKS,
    ]);

    await nextTick();
    finishLoading(packs);

    await expect(waiting).resolves.toBeUndefined();
  });

  it("espera también al indicador en español", async () => {
    const positions = addSection(POSITIONS, "Cargando las posiciones…");
    const waiting = waitForSectionsLoaded(fakePage(), [POSITIONS]);

    await nextTick();
    finishLoading(positions);

    await expect(waiting).resolves.toBeUndefined();
  });

  it("falla nombrando la sección que se queda cargando", async () => {
    addSection(POSITIONS, null);
    addSection(SESSION_PACKS, "Loading the session packs…");

    await expect(
      waitForSectionsLoaded(fakePage(), [POSITIONS, SESSION_PACKS]),
    ).rejects.toThrow(`"${SESSION_PACKS}"`);
  });

  it("falla nombrando la sección que el estado espera y no aparece", async () => {
    addSection(POSITIONS, null);

    await expect(
      waitForSectionsLoaded(fakePage(), [POSITIONS, SESSION_PACKS]),
    ).rejects.toThrow(`"${SESSION_PACKS}"`);
  });

  it("falla si queda un indicador de carga fuera de las secciones", async () => {
    addSection(POSITIONS, null);
    const loading = document.createElement("p");
    loading.textContent = "Loading the club settings…";
    document.body.append(loading);

    await expect(
      waitForSectionsLoaded(fakePage(), [POSITIONS]),
    ).rejects.toThrow(/página/);
  });

  it("espera cada sección con el tiempo máximo con nombre", async () => {
    addSection(POSITIONS, null);
    addSection(SESSION_PACKS, null);
    const page = fakePage();

    await waitForSectionsLoaded(page, [POSITIONS, SESSION_PACKS]);

    // Una espera por sección y otra por la página entera.
    expect(page.timeouts).toEqual([
      SECTION_LOAD_TIMEOUT_MS,
      SECTION_LOAD_TIMEOUT_MS,
      SECTION_LOAD_TIMEOUT_MS,
    ]);
  });

  it("deja pasar sin tocar un error que no es el plazo agotado", async () => {
    const closed = new Error("Target page, context or browser has been closed");
    const page = {
      waitForFunction: () => Promise.reject(closed),
    } as unknown as SectionsPage;

    await expect(waitForSectionsLoaded(page, [POSITIONS])).rejects.toBe(closed);
  });
});
