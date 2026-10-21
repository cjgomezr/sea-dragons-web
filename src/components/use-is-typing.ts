"use client";

import { useEffect, useState } from "react";
import { isTypingInto } from "@/components/is-typing-into";

/** Los eventos que sueltan el dedo o el botón del ratón. */
const POINTER_RELEASE_EVENTS = ["pointerup", "pointercancel"] as const;

/**
 * Si el foco está en un campo que saca el teclado del móvil (#840). Sigue los
 * eventos de foco en vez de leer `document.activeElement`: entre dos campos,
 * el foco sale de uno antes de entrar en el otro, y mirar adónde va
 * (`relatedTarget`) evita un instante sin campo en el que la barra de
 * pestañas reaparecería.
 *
 * Si el foco sale mientras se pulsa algo, el `false` espera a que se suelte y
 * a que pase el clic: la barra reaparecería encima de Guardar y el clic caería
 * en ella.
 */
export function useIsTyping(): boolean {
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    let isPointerDown = false;
    let isReleasePending = false;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;

    const showAfterClick = (): void => {
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => {
        setIsTyping(isTypingInto(document.activeElement));
      });
    };
    const handlePointerDown = (): void => {
      isPointerDown = true;
    };
    const handlePointerRelease = (): void => {
      isPointerDown = false;
      if (isReleasePending) {
        isReleasePending = false;
        showAfterClick();
      }
    };
    const followFocus = (focused: EventTarget | null): void => {
      const isFocusInField = isTypingInto(focused);
      isReleasePending = !isFocusInField && isPointerDown;
      if (!isReleasePending) {
        setIsTyping(isFocusInField);
      }
    };
    const handleFocusIn = (event: FocusEvent): void => {
      followFocus(event.target);
    };
    const handleFocusOut = (event: FocusEvent): void => {
      followFocus(event.relatedTarget);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    POINTER_RELEASE_EVENTS.forEach((type) =>
      document.addEventListener(type, handlePointerRelease, true),
    );
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    return () => {
      clearTimeout(releaseTimer);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      POINTER_RELEASE_EVENTS.forEach((type) =>
        document.removeEventListener(type, handlePointerRelease, true),
      );
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  return isTyping;
}
