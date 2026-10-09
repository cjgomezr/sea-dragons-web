import { afterEach, describe, expect, it } from "vitest";
import {
  HYDRATION_TIMEOUT_MS,
  type HydrationPage,
  waitForHydration,
} from "../../support/wait-for-hydration";

const PHOTO_INPUT = "input.account-photo-input";
/** Las vueltas que da el `page` fingido antes de rendirse, como haría
 * Playwright al agotar el plazo. */
const FAKE_POLLS = 20;

type WaitOptions = { readonly timeout?: number };

/** Un `page` que evalúa la condición sobre el DOM de jsdom, vuelta a vuelta,
 * y se rinde como Playwright con un `TimeoutError` si nunca se cumple. */
function fakePage(): HydrationPage & { readonly timeouts: number[] } {
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
  // El de verdad devuelve un `JSHandle`; `waitForHydration` no lo usa.
  return page as unknown as HydrationPage & { readonly timeouts: number[] };
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function addPhotoInput(): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.className = "account-photo-input";
  document.body.append(input);
  return input;
}

/** Lo que deja React en el nodo al hidratarlo. */
function hydrate(element: Element): void {
  Object.assign(element, { __reactFiber$abc123: {} });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("waitForHydration (#557)", () => {
  it("resuelve cuando el elemento ya está hidratado", async () => {
    hydrate(addPhotoInput());

    await expect(
      waitForHydration(fakePage(), PHOTO_INPUT),
    ).resolves.toBeUndefined();
  });

  it("resuelve en cuanto React hidrata un elemento que ya estaba", async () => {
    const input = addPhotoInput();
    const waiting = waitForHydration(fakePage(), PHOTO_INPUT);

    await nextTick();
    hydrate(input);

    await expect(waiting).resolves.toBeUndefined();
  });

  it("espera con el tiempo máximo con nombre", async () => {
    hydrate(addPhotoInput());
    const page = fakePage();

    await waitForHydration(page, PHOTO_INPUT);

    expect(page.timeouts).toEqual([HYDRATION_TIMEOUT_MS]);
  });

  it("falla nombrando el selector si el elemento nunca se hidrata", async () => {
    addPhotoInput();

    await expect(waitForHydration(fakePage(), PHOTO_INPUT)).rejects.toThrow(
      `"${PHOTO_INPUT}"`,
    );
  });

  it("falla nombrando el selector si el elemento no existe", async () => {
    await expect(waitForHydration(fakePage(), PHOTO_INPUT)).rejects.toThrow(
      `"${PHOTO_INPUT}"`,
    );
  });

  it("deja pasar sin tocar un error que no es el plazo agotado", async () => {
    const closed = new Error("Target page, context or browser has been closed");
    const page = {
      waitForFunction: () => Promise.reject(closed),
    } as unknown as HydrationPage;

    await expect(waitForHydration(page, PHOTO_INPUT)).rejects.toBe(closed);
  });
});
