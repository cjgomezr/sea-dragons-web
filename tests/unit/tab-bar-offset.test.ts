import { describe, expect, it } from "vitest";
import { tabBarOffset } from "@/lib/tab-bar-offset";

/**
 * #703: Chrome en el iPhone esconde su barra de abajo y la ventana visible
 * crece, pero la barra de pestañas se queda donde estaba. El desfase entre el
 * fondo de lo visible y el borde de la barra es lo que hay que bajarla.
 */

const BAR_BOTTOM = 664;

describe("desfase de la barra de pestañas", () => {
  it("es 0 cuando la barra ya coincide con el fondo visible", () => {
    const offset = tabBarOffset({
      barBottom: BAR_BOTTOM,
      visualViewport: { height: BAR_BOTTOM, offsetTop: 0, scale: 1 },
      isKeyboardOpen: false,
    });

    expect(offset).toBe(0);
  });

  it("baja la barra lo que la ventana visible creció por debajo", () => {
    const offset = tabBarOffset({
      barBottom: BAR_BOTTOM,
      visualViewport: { height: BAR_BOTTOM + 49, offsetTop: 0, scale: 1 },
      isKeyboardOpen: false,
    });

    expect(offset).toBe(49);
  });

  it("cuenta el desplazamiento de la ventana visible dentro de la página", () => {
    const offset = tabBarOffset({
      barBottom: BAR_BOTTOM,
      visualViewport: { height: BAR_BOTTOM, offsetTop: 30, scale: 1 },
      isKeyboardOpen: false,
    });

    expect(offset).toBe(30);
  });

  it("sube la barra cuando la ventana visible es más baja que su borde", () => {
    const offset = tabBarOffset({
      barBottom: BAR_BOTTOM,
      visualViewport: { height: BAR_BOTTOM - 20, offsetTop: 0, scale: 1 },
      isKeyboardOpen: false,
    });

    expect(offset).toBe(-20);
  });

  it("es 0 con el teclado abierto, para que la barra no suba encima de él", () => {
    const offset = tabBarOffset({
      barBottom: BAR_BOTTOM,
      visualViewport: { height: BAR_BOTTOM - 300, offsetTop: 0, scale: 1 },
      isKeyboardOpen: true,
    });

    expect(offset).toBe(0);
  });

  it("es 0 sin visualViewport", () => {
    const offset = tabBarOffset({
      barBottom: BAR_BOTTOM,
      visualViewport: null,
      isKeyboardOpen: false,
    });

    expect(offset).toBe(0);
  });

  it("es 0 con la página ampliada con dos dedos", () => {
    const offset = tabBarOffset({
      barBottom: BAR_BOTTOM,
      visualViewport: { height: 332, offsetTop: 100, scale: 2 },
      isKeyboardOpen: false,
    });

    expect(offset).toBe(0);
  });

  it("no sube la barra al tirar de la página para refrescar", () => {
    // Al tirar hacia abajo, Chrome en el iPhone estira la página por encima
    // de su borde y offsetTop pasa a ser negativo mientras dura el gesto.
    const offset = tabBarOffset({
      barBottom: BAR_BOTTOM,
      visualViewport: { height: BAR_BOTTOM, offsetTop: -110, scale: 1 },
      isKeyboardOpen: false,
    });

    expect(offset).toBe(0);
  });

  it("es 0 cuando el desfase es menor que un píxel", () => {
    const offset = tabBarOffset({
      barBottom: BAR_BOTTOM,
      visualViewport: { height: BAR_BOTTOM + 0.4, offsetTop: 0, scale: 1 },
      isKeyboardOpen: false,
    });

    expect(offset).toBe(0);
  });
});
