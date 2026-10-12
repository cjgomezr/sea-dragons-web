import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { BottomSheet } from "@/components/directory/BottomSheet";

/**
 * La hoja que sube desde abajo en el móvil (#579): el foco al abrirse y el
 * arrastre desde arriba. La usan la ficha del socio, los filtros, el orden y
 * el "⋯"; aquí se prueba una sola vez, con un arnés que la abre desde un
 * botón y le devuelve el foco al cerrarse, como hacen todas.
 *
 * Que la hoja se vea bajar y que el contorno no se pinte lo prueba
 * Playwright; aquí, cuánto se mueve y cuándo se cierra. Abrirla con el
 * teclado se prueba sobre la fila del directorio
 * (`directory-member-sheet.test.tsx`): el `:focus-visible` de jsdom mira el
 * evento en curso y, durante el clic que manda Enter sobre un botón, dice
 * que no, cosa que un navegador no hace.
 */

const OPENER = "Open the sheet";
const SHEET = "Nerea Ruiz";
const GRIP = "Close the sheet";
const ACTION = "Call Nerea";

function SheetHarness(): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={openerRef} type="button" onClick={() => setIsOpen(true)}>
        {OPENER}
      </button>
      {isOpen ? (
        <BottomSheet
          title={(titleId) => (
            <header>
              <h2 id={titleId}>{SHEET}</h2>
            </header>
          )}
          gripLabel={GRIP}
          onClosed={() => {
            setIsOpen(false);
            openerRef.current?.focus();
          }}
        >
          {() => (
            <section aria-label="Details">
              <button type="button">{ACTION}</button>
            </section>
          )}
        </BottomSheet>
      ) : null}
    </>
  );
}

function sheet(): HTMLElement {
  return screen.getByRole("dialog", { name: SHEET });
}

function queryOpenSheet(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: SHEET });
}

function header(): HTMLElement {
  return screen.getByRole("heading", { name: SHEET });
}

function grip(): HTMLElement {
  return within(sheet()).getByRole("button", { name: GRIP });
}

async function openWithFinger(): Promise<void> {
  const user = userEvent.setup();
  render(<SheetHarness />);
  await user.click(screen.getByRole("button", { name: OPENER }));
}

/** Un dedo que se apoya, baja por pasos y se queda sin soltar. */
function pressAndMove(
  element: HTMLElement,
  distances: readonly number[],
): void {
  const startY = 300;
  fireEvent.pointerDown(element, {
    clientX: 180,
    clientY: startY,
    pointerId: 1,
  });
  for (const distance of distances) {
    fireEvent.pointerMove(element, {
      clientX: 180,
      clientY: startY + distance,
      pointerId: 1,
    });
  }
}

/** Suelta donde se quedó y manda el clic que el navegador manda después. */
function release(element: HTMLElement, distance: number): void {
  const end = { clientX: 180, clientY: 300 + distance, pointerId: 1 };
  fireEvent.pointerUp(element, end);
  fireEvent.click(element, end);
}

function drag(element: HTMLElement, distance: number): void {
  pressAndMove(element, [distance / 2, distance]);
  release(element, distance);
}

describe("la hoja que sube: el foco al abrirse", () => {
  it("abierta con el dedo, el foco no se queda en el asa", async () => {
    await openWithFinger();

    expect(grip()).not.toHaveFocus();
    expect(sheet()).toContainElement(document.activeElement as HTMLElement);
  });
});

describe("la hoja que sube: arrastrarla desde arriba", () => {
  it("baja siguiendo al dedo mientras se arrastra la cabecera", async () => {
    await openWithFinger();

    pressAndMove(header(), [30, 60]);

    expect(sheet().style.transform).toBe("translateY(60px)");
  });

  it("arrastrar desde la cabecera más allá del umbral cierra la hoja y devuelve el foco", async () => {
    await openWithFinger();

    drag(header(), 160);

    expect(queryOpenSheet()).toBeNull();
    expect(screen.getByRole("button", { name: OPENER })).toHaveFocus();
  });

  it("arrastrar el asa más allá del umbral también la cierra", async () => {
    await openWithFinger();

    drag(grip(), 160);

    expect(queryOpenSheet()).toBeNull();
  });

  it("soltar antes del umbral deja la hoja abierta y en su sitio", async () => {
    await openWithFinger();

    drag(header(), 40);

    expect(sheet()).toBeVisible();
    expect(sheet().style.transform).toBe("");
  });

  it("soltar el asa antes del umbral no la cierra con el clic que llega después", async () => {
    await openWithFinger();

    drag(grip(), 40);

    expect(sheet()).toBeVisible();
  });

  it("arrastrar hacia arriba no mueve la hoja", async () => {
    await openWithFinger();

    pressAndMove(header(), [-30, -80]);

    expect(sheet().style.transform).toBe("");
  });

  it("deslizar dentro del contenido no arrastra la hoja", async () => {
    await openWithFinger();
    const action = within(sheet()).getByRole("button", { name: ACTION });

    pressAndMove(action, [60, 160]);

    expect(sheet().style.transform).toBe("");
    release(action, 160);
    expect(sheet()).toBeVisible();
  });

  it("un toque corto en el asa la cierra", async () => {
    const user = userEvent.setup();
    await openWithFinger();

    await user.click(grip());

    expect(queryOpenSheet()).toBeNull();
  });
});
