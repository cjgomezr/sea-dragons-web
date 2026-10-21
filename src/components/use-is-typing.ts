"use client";

import { useEffect, useState } from "react";
import { isTypingInto } from "@/components/is-typing-into";

/**
 * Si el foco está en un campo que saca el teclado del móvil (#840). Sigue los
 * eventos de foco en vez de leer `document.activeElement`: entre dos campos,
 * el foco sale de uno antes de entrar en el otro, y mirar adónde va
 * (`relatedTarget`) evita un instante sin campo en el que la barra de
 * pestañas reaparecería.
 */
export function useIsTyping(): boolean {
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    const handleFocusIn = (event: FocusEvent): void => {
      setIsTyping(isTypingInto(event.target));
    };
    const handleFocusOut = (event: FocusEvent): void => {
      setIsTyping(isTypingInto(event.relatedTarget));
    };
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  return isTyping;
}
