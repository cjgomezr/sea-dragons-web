import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { returnFocus, wasLastInputPointer } from "@/components/input-modality";

/**
 * Con qué llegó lo último que hizo quien mira (el teclado o un puntero), y
 * el foco que se devuelve sin contorno tras un toque. Safari pinta el
 * contorno de un `focus()` hecho por código aunque lo provoque un dedo; que
 * no se pinte con este atributo lo prueba el CSS en el navegador.
 */

function addButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  document.body.append(button);
  return button;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("la última forma de entrada", () => {
  it("un toque o un clic la marcan como puntero", () => {
    fireEvent.keyDown(document.body, { key: "Tab" });

    fireEvent.pointerDown(document.body);

    expect(wasLastInputPointer()).toBe(true);
  });

  it("una tecla la marca como teclado", () => {
    fireEvent.pointerDown(document.body);

    fireEvent.keyDown(document.body, { key: "Tab" });

    expect(wasLastInputPointer()).toBe(false);
  });
});

describe("devolver el foco", () => {
  it("tras un toque llega sin contorno", () => {
    const button = addButton();
    fireEvent.pointerDown(document.body);

    returnFocus(button);

    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("data-quiet-focus");
  });

  it("al salir del elemento vuelve a poder pintarse el contorno", () => {
    const button = addButton();
    fireEvent.pointerDown(document.body);
    returnFocus(button);

    addButton().focus();

    expect(button).not.toHaveAttribute("data-quiet-focus");
  });

  it("devolverlo dos veces seguidas no apila otro aviso de salida", () => {
    const button = addButton();
    const listen = vi.spyOn(button, "addEventListener");
    fireEvent.pointerDown(document.body);

    returnFocus(button);
    returnFocus(button);

    expect(listen.mock.calls.filter(([type]) => type === "blur")).toHaveLength(
      1,
    );
  });

  it("tras una tecla llega con su contorno", () => {
    const button = addButton();
    fireEvent.keyDown(document.body, { key: "Escape" });

    returnFocus(button);

    expect(button).toHaveFocus();
    expect(button).not.toHaveAttribute("data-quiet-focus");
  });
});
