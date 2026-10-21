"use client";

import { type RefObject, useEffect } from "react";
import { useIsPhone } from "@/components/use-is-phone";
import { isTypingInto } from "@/components/is-typing-into";
import { tabBarOffset } from "@/lib/tab-bar-offset";

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
 * scroll, y pasarlo por el estado de React repintaría la barra entera. Los
 * eventos de un mismo cuadro se juntan en un `requestAnimationFrame` (#840):
 * medir la barra en cada uno fuerza al navegador a maquetar de más.
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

    let pendingFrame: number | null = null;
    const scheduleReposition = (): void => {
      if (pendingFrame !== null) {
        return;
      }
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null;
        reposition();
      });
    };

    reposition();
    visualViewport.addEventListener("resize", scheduleReposition);
    visualViewport.addEventListener("scroll", scheduleReposition);
    return () => {
      visualViewport.removeEventListener("resize", scheduleReposition);
      visualViewport.removeEventListener("scroll", scheduleReposition);
      if (pendingFrame !== null) {
        cancelAnimationFrame(pendingFrame);
      }
      element.style.transform = "";
    };
  }, [elementRef, isPhone]);
}
