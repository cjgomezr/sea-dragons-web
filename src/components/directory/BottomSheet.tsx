"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useDismissal } from "@/components/use-dismissal";

/**
 * La hoja que sube desde abajo en el móvil: un `<dialog>` modal, como el
 * visor de la foto (#355), con lo que comparte con él por `useDismissal`.
 * Nació con los filtros (#497); el orden y el menú "⋯" del rediseño (#553)
 * son la segunda y la tercera, y por eso vive aquí.
 *
 * Al abrirse, el foco entra en su primer control y no sale mientras esté
 * abierta. Escape, un toque fuera o `close`, que reciben sus controles, la
 * cierran; quién recibe después el foco lo decide quien la abrió, en
 * `onClosed`, porque sólo él sabe qué botón la abrió. Sus controles la
 * cierran con `close` y no desmontándola: mientras el `<dialog>` siga
 * abierto, el foco que sale de él vuelve dentro.
 */

const FOCUSABLE_SELECTOR = "select, input, button";

function focusableIn(panel: HTMLElement | null): readonly HTMLElement[] {
  return panel === null
    ? []
    : [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

/** Tab desde el último control vuelve al primero, y Mayúsculas+Tab desde el
 * primero va al último. El `<dialog>` modal deja inerte la página, pero no
 * impide que el foco salga a la barra del navegador. */
function cycleFocus(
  event: React.KeyboardEvent,
  panel: HTMLElement | null,
): void {
  if (event.key !== "Tab") {
    return;
  }
  const focusable = focusableIn(panel);
  const first = focusable.at(0);
  const last = focusable.at(-1);
  const edge = event.shiftKey ? first : last;
  if (edge === undefined || document.activeElement !== edge) {
    return;
  }
  event.preventDefault();
  (event.shiftKey ? last : first)?.focus();
}

export function BottomSheet({
  title,
  titleClassName = "directory-sheet-title",
  onClosed,
  children,
}: {
  title: string;
  /** El de los filtros es un título; el del orden y el del "⋯", una
   * etiqueta pequeña en mayúsculas, como en el diseño. */
  titleClassName?: string;
  /** Se llama una vez cerrada, sea por Escape, por un toque fuera o por
   * `close`. */
  onClosed: () => void;
  children: (close: () => void) => React.ReactNode;
}): React.JSX.Element {
  const titleId = useId();
  // El `<dialog>` va en el estado y no en una referencia: `close` llega a
  // los controles mientras se pinta, y lo que se lee al pintar no puede ser
  // una referencia.
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const focusFirstControl = useCallback(() => {
    focusableIn(panelRef.current).at(0)?.focus();
  }, []);

  useEffect(() => {
    if (dialog === null) {
      return;
    }
    dialog.showModal();
    focusFirstControl();
  }, [dialog, focusFirstControl]);

  const close = useCallback(() => dialog?.close(), [dialog]);
  const pressOutside = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      close();
    },
    [close],
  );
  const keepFocusInside = useCallback(() => {
    if (dialog?.open === true) {
      focusFirstControl();
    }
  }, [dialog, focusFirstControl]);
  useDismissal({
    isOpen: true,
    containerRef: panelRef,
    onEscape: close,
    onPressOutside: pressOutside,
    onFocusOutside: keepFocusInside,
  });

  return (
    <dialog
      ref={setDialog}
      className="directory-sheet"
      aria-labelledby={titleId}
      onClose={onClosed}
      onKeyDown={(event) => cycleFocus(event, panelRef.current)}
    >
      <div ref={panelRef} className="directory-sheet-panel">
        <h2 id={titleId} className={titleClassName}>
          {title}
        </h2>
        {children(close)}
      </div>
    </dialog>
  );
}
