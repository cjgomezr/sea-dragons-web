"use client";

import { type RefObject, useEffect } from "react";
import { useIsPhone } from "@/components/use-is-phone";
import { tabBarOffset } from "@/lib/tab-bar-offset";

/** Los `<input>` que no sacan el teclado del móvil. */
const INPUT_TYPES_WITHOUT_KEYBOARD: ReadonlySet<string> = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

function isTypingInto(element: Element | null): boolean {
  if (element instanceof HTMLInputElement) {
    return !INPUT_TYPES_WITHOUT_KEYBOARD.has(element.type);
  }
  return (
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

function offsetFromTransform(element: HTMLElement): number {
  const match = /translateY\((-?[\d.]+)px\)/.exec(element.style.transform);
  return match?.[1] === undefined ? 0 : Number(match[1]);
}

/**
 * Lleva el elemento fijo al fondo de `window.visualViewport` cuando el
 * navegador lo deja más arriba o más abajo (#703, Chrome en el iPhone). Sólo
 * en el móvil: a 768 px o más la barra está oculta y no se escucha nada.
 *
 * El desplazamiento se escribe directo en `style.transform`: llega con cada
 * scroll, y pasarlo por el estado de React repintaría la barra entera.
 */
export function useStickToVisualBottom(
  elementRef: RefObject<HTMLElement | null>,
): void {
  const isPhone = useIsPhone();

  useEffect(() => {
    const element = elementRef.current;
    // Los tipos del DOM dicen `VisualViewport | null`, pero un navegador sin
    // la API ni siquiera tiene la propiedad: ahí la barra se queda como hoy.
    const visualViewport = window.visualViewport ?? null;
    if (!isPhone || element === null || visualViewport === null) {
      return;
    }

    const reposition = (): void => {
      const barBottom =
        element.getBoundingClientRect().bottom - offsetFromTransform(element);
      const offset = tabBarOffset({
        barBottom,
        visualViewport,
        isKeyboardOpen: isTypingInto(document.activeElement),
      });
      element.style.transform = offset === 0 ? "" : `translateY(${offset}px)`;
    };

    reposition();
    visualViewport.addEventListener("resize", reposition);
    visualViewport.addEventListener("scroll", reposition);
    return () => {
      visualViewport.removeEventListener("resize", reposition);
      visualViewport.removeEventListener("scroll", reposition);
      element.style.transform = "";
    };
  }, [elementRef, isPhone]);
}
