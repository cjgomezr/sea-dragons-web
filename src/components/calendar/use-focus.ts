import { useEffect, useRef } from "react";

/**
 * Dónde cae el foco cuando un paso del calendario aparece o se va: la
 * pregunta de una confirmación, el campo que se abre, el botón al que se
 * vuelve. Lo comparten las acciones de quien organiza y el vídeo de la
 * sesión.
 */

/** La pregunta de un paso recibe el foco al aparecer, para que el lector de
 * pantalla la lea y el teclado siga desde ahí. */
export function useFocusOnMount<
  Element extends HTMLElement,
>(): React.RefObject<Element | null> {
  return useFocusWhen<Element>(true);
}

/** Enfoca el elemento cuando le toca, también al montarse. */
export function useFocusWhen<Element extends HTMLElement>(
  shouldFocus: boolean,
): React.RefObject<Element | null> {
  const ref = useRef<Element>(null);
  useEffect(() => {
    if (shouldFocus) {
      ref.current?.focus();
    }
  }, [shouldFocus]);
  return ref;
}
