import { useRef } from "react";
import type { Translator } from "@/lib/i18n/translator";
import type { NewsPinDuration } from "@/lib/news/news-pin-duration";
import { describePinFailure } from "./news-pin-client";
import type { PostPinning } from "./use-news-pinning";

/**
 * Lo que comparten la chincheta de una fila y el "Fijar" de la destacada
 * (#595): lo que pueden hacer, devolver el foco al cerrar la tira y el aviso
 * de error, que va dentro de su fila o tarjeta y no arriba de la página.
 */

export type PinControls = {
  readonly pinning: PostPinning;
  /** Si hay otra fijada que fijar esta reemplazaría. */
  readonly replacesPinned: boolean;
  readonly onToggleStrip: () => void;
  readonly onCloseStrip: () => void;
  readonly onChoose: (duration: NewsPinDuration) => void;
  readonly onUnpin: () => void;
};

/** Cerrar la tira con Cancelar o Esc devuelve el foco al botón que la abrió,
 * para que el teclado siga donde estaba. */
export function usePinStripToggle(controls: PinControls): {
  readonly toggleRef: React.RefObject<HTMLButtonElement | null>;
  readonly cancel: () => void;
  readonly onToggleKeyDown: (event: React.KeyboardEvent) => void;
} {
  const toggleRef = useRef<HTMLButtonElement>(null);

  function cancel(): void {
    controls.onCloseStrip();
    toggleRef.current?.focus();
  }

  return {
    toggleRef,
    cancel,
    onToggleKeyDown: (event) => {
      if (event.key === "Escape" && controls.pinning.isStripOpen) {
        cancel();
      }
    },
  };
}

export function NewsPinFailure({
  translate,
  pinning,
}: {
  readonly translate: Translator;
  readonly pinning: PostPinning;
}): React.JSX.Element | null {
  if (pinning.failure === null) {
    return null;
  }
  return (
    <p className="auth-error news-pin-error" role="alert">
      {describePinFailure(
        translate,
        pinning.failure.action,
        pinning.failure.failure,
      )}
    </p>
  );
}
