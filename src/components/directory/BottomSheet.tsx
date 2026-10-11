"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useDismissal } from "@/components/use-dismissal";

/**
 * La hoja que sube desde abajo en el móvil: un `<dialog>` modal, como el
 * visor de la foto (#355), con lo que comparte con él por `useDismissal`.
 * Nació con los filtros (#497); el orden y el menú "⋯" del rediseño (#553)
 * son la segunda y la tercera, y por eso vive aquí. La ficha del socio
 * (#554) es la cuarta, y la primera con asa y con un encabezado propio.
 *
 * Al abrirse, el foco entra en su primer control y no sale mientras esté
 * abierta. Escape, un toque fuera o `close`, que reciben sus controles, la
 * cierran; quién recibe después el foco lo decide quien la abrió, en
 * `onClosed`, porque sólo él sabe qué botón la abrió. Sus controles la
 * cierran con `close` y no desmontándola: mientras el `<dialog>` siga
 * abierto, el foco que sale de él vuelve dentro.
 */

const FOCUSABLE_SELECTOR = "select, input, button:not(:disabled), a[href]";

/** Lo que hay que arrastrar el asa hacia abajo para que la hoja se cierre.
 * Menos se confunde con un toque que tiembla. */
const GRIP_CLOSE_DISTANCE_PX = 40;

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

/** El asa de arriba: se arrastra hacia abajo para cerrar, como en el
 * diseño. Es un botón para que quien no arrastra, con el teclado o con un
 * lector de pantalla, también tenga con qué cerrarla. */
function SheetGrip({
  label,
  onClose,
}: {
  label: string;
  onClose: () => void;
}): React.JSX.Element {
  const startYRef = useRef<number | null>(null);
  return (
    <button
      type="button"
      className="directory-sheet-grip"
      aria-label={label}
      title={label}
      onClick={onClose}
      onPointerDown={(event) => {
        startYRef.current = event.clientY;
      }}
      onPointerUp={(event) => {
        const startY = startYRef.current;
        startYRef.current = null;
        if (
          startY !== null &&
          event.clientY - startY >= GRIP_CLOSE_DISTANCE_PX
        ) {
          onClose();
        }
      }}
    />
  );
}

export function BottomSheet({
  title,
  titleClassName = "directory-sheet-title",
  gripLabel,
  onClosed,
  children,
}: {
  /** El texto del título o, si la hoja lleva un encabezado propio, lo que
   * lo pinta: su título tiene que llevar el id que recibe. */
  title: string | ((titleId: string) => React.ReactNode);
  /** El de los filtros es un título; el del orden y el del "⋯", una
   * etiqueta pequeña en mayúsculas, como en el diseño. */
  titleClassName?: string;
  /** Con él, la hoja lleva arriba un asa que la cierra; es su nombre. */
  gripLabel?: string;
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
        {gripLabel === undefined ? null : (
          <SheetGrip label={gripLabel} onClose={close} />
        )}
        {typeof title === "string" ? (
          <h2 id={titleId} className={titleClassName}>
            {title}
          </h2>
        ) : (
          title(titleId)
        )}
        {children(close)}
      </div>
    </dialog>
  );
}
