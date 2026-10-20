"use client";

import { useCallback, useRef, useState } from "react";
import { useDismissal } from "./use-dismissal";

/**
 * Un desplegable que se abre con un botón y se cierra como el menú de la
 * cuenta (#287): con Escape, con un clic fuera o cuando el foco sale de él,
 * y entonces el foco vuelve al botón. Lo usan el menú de la cuenta y el ⋯ de
 * la ficha de un socio (#775).
 *
 * El botón lo pone quien llama, porque a veces también tiene que devolverle
 * el foco por su cuenta: la ficha lo hace al cancelar la franja de
 * desactivar.
 */

/** Lo que se queda con el foco al pulsarlo. */
const FOCUSABLE_SELECTOR =
  "a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]";

function canTakeFocus(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest(FOCUSABLE_SELECTOR) !== null
  );
}

export type DropdownMenu = {
  readonly isOpen: boolean;
  /** Lo que cuenta como dentro: el botón y el desplegable. */
  readonly containerRef: React.RefObject<HTMLDivElement | null>;
  readonly open: () => void;
  readonly toggle: () => void;
  /** Cierra y deja el foco donde el usuario lo puso: al navegar. */
  readonly close: () => void;
  readonly closeAndReturnFocus: () => void;
};

export function useDropdownMenu(
  buttonRef: React.RefObject<HTMLButtonElement | null>,
): DropdownMenu {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const close = useCallback(() => setIsOpen(false), []);
  const closeAndReturnFocus = useCallback(() => {
    setIsOpen(false);
    buttonRef.current?.focus();
  }, [buttonRef]);
  // Un clic fuera sobre algo que toma el foco se lo cede; sobre cualquier
  // otra cosa el navegador lo dejaría en el `body`, y ahí se pierde quien
  // navega con teclado.
  const pressOutside = useCallback(
    (event: MouseEvent) => {
      if (canTakeFocus(event.target)) {
        close();
        return;
      }
      event.preventDefault();
      closeAndReturnFocus();
    },
    [close, closeAndReturnFocus],
  );
  useDismissal({
    isOpen,
    containerRef,
    onEscape: closeAndReturnFocus,
    onPressOutside: pressOutside,
    onFocusOutside: closeAndReturnFocus,
  });

  return {
    isOpen,
    containerRef,
    open: useCallback(() => setIsOpen(true), []),
    toggle: () => setIsOpen((wasOpen) => !wasOpen),
    close,
    closeAndReturnFocus,
  };
}
