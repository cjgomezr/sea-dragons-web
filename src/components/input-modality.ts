"use client";

/**
 * Con qué llegó lo último que hizo quien mira: el teclado o un puntero (un
 * dedo o el ratón). `:focus-visible` no sirve para saberlo: Safari pinta el
 * contorno de un `focus()` hecho por código aunque lo haya provocado un
 * toque. Se escucha en la fase de captura desde que se carga el módulo, antes
 * de que ningún control reaccione a la tecla o al toque.
 */

type InputModality = "keyboard" | "pointer";

let lastModality: InputModality | null = null;

if (typeof document !== "undefined") {
  document.addEventListener(
    "keydown",
    () => {
      lastModality = "keyboard";
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    () => {
      lastModality = "pointer";
    },
    true,
  );
}

export function wasLastInputPointer(): boolean {
  return lastModality === "pointer";
}

/** El atributo con el que el CSS calla el contorno de un foco devuelto tras
 * un toque. */
const QUIET_FOCUS_ATTRIBUTE = "data-quiet-focus";

/** Devuelve el foco a un elemento, por ejemplo al cerrar una hoja. Tras un
 * toque llega igual, para que un lector de pantalla siga donde estaba, pero
 * sin contorno hasta que el foco salga de él. Tras una tecla, con contorno. */
export function returnFocus(element: HTMLElement): void {
  if (wasLastInputPointer() && !element.hasAttribute(QUIET_FOCUS_ATTRIBUTE)) {
    element.setAttribute(QUIET_FOCUS_ATTRIBUTE, "");
    element.addEventListener(
      "blur",
      () => element.removeAttribute(QUIET_FOCUS_ATTRIBUTE),
      { once: true },
    );
  }
  element.focus();
}
