"use client";

import { useEffect } from "react";

/**
 * Lo que tiene todo lo que se abre encima de la pantalla: se cierra con
 * Escape, al pulsar fuera, y decide qué hacer cuando el foco sale de él.
 *
 * Lo copiaron la lista de avisos (#266) y el menú de la cuenta (#287); el
 * visor de la foto de perfil (#355) es la tercera vez, y por eso vive aquí.
 * Qué hace cada uno al cerrar es suyo: los dos desplegables sueltan el foco
 * donde el usuario lo puso, y el visor, que es modal, lo devuelve a la foto
 * o lo retiene dentro.
 *
 * Se escucha `mousedown` y no `pointerdown` porque es el evento cuyo efecto
 * por defecto mueve el foco: quien lo recibe todavía puede impedirlo.
 */
export function useDismissal(options: {
  readonly isOpen: boolean;
  /** Lo que cuenta como dentro. Un clic o un foco fuera de él es salir. */
  readonly containerRef: React.RefObject<HTMLElement | null>;
  readonly onEscape: () => void;
  readonly onPressOutside: (event: MouseEvent) => void;
  readonly onFocusOutside: () => void;
}): void {
  const { isOpen, containerRef, onEscape, onPressOutside, onFocusOutside } =
    options;
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function isOutside(target: EventTarget | null): boolean {
      const container = containerRef.current;
      return (
        container !== null &&
        target instanceof Node &&
        !container.contains(target)
      );
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onEscape();
      }
    }
    function handleMouseDown(event: MouseEvent): void {
      if (isOutside(event.target)) {
        onPressOutside(event);
      }
    }
    function handleFocusIn(event: FocusEvent): void {
      if (isOutside(event.target)) {
        onFocusOutside();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("focusin", handleFocusIn);
    };
  }, [isOpen, containerRef, onEscape, onPressOutside, onFocusOutside]);
}
