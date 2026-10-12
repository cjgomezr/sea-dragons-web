"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useDismissal } from "@/components/use-dismissal";
import { useSheetDrag } from "./use-sheet-drag";

/**
 * La hoja que sube desde abajo en el móvil: un `<dialog>` modal, como el
 * visor de la foto (#355), con lo que comparte con él por `useDismissal`.
 * Nació con los filtros (#497); el orden y el menú "⋯" del rediseño (#553)
 * son la segunda y la tercera, y por eso vive aquí. La ficha del socio
 * (#554) es la cuarta, y la primera con asa y con un encabezado propio.
 *
 * Al abrirse, el foco entra en ella y no sale mientras esté abierta. Si la
 * abrió el teclado, va a su primer control, con su contorno; si la abrió un
 * dedo, al panel, que no pinta ninguno (#579): Safari pinta el contorno de
 * un `focus()` hecho tras un toque, y el primer control es el asa. Escape, un toque fuera o `close`, que reciben sus controles, la
 * cierran; quién recibe después el foco lo decide quien la abrió, en
 * `onClosed`, porque sólo él sabe qué botón la abrió. Sus controles la
 * cierran con `close` y no desmontándola: mientras el `<dialog>` siga
 * abierto, el foco que sale de él vuelve dentro.
 *
 * Se cierra también arrastrándola hacia abajo desde arriba: el asa y el
 * título, o el encabezado propio (`useSheetDrag`).
 */

const FOCUSABLE_SELECTOR = "select, input, button:not(:disabled), a[href]";

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

/** Quien abre la hoja con el teclado deja el foco con su contorno en el
 * botón o la fila que la abre; un toque no. */
function isOpenedFromKeyboard(): boolean {
  return document.activeElement?.matches(":focus-visible") === true;
}

/** El asa de arriba: se toca o se arrastra hacia abajo para cerrar, como en
 * el diseño. Es un botón para que quien no arrastra, con el teclado o con un
 * lector de pantalla, también tenga con qué cerrarla. */
function SheetGrip({
  label,
  onClose,
}: {
  label: string;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="directory-sheet-grip"
      aria-label={label}
      title={label}
      onClick={onClose}
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
    const isKeyboardOpening = isOpenedFromKeyboard();
    dialog.showModal();
    if (isKeyboardOpening) {
      focusFirstControl();
    } else {
      panelRef.current?.focus();
    }
  }, [dialog, focusFirstControl]);

  const close = useCallback(() => dialog?.close(), [dialog]);
  const drag = useSheetDrag(close);
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
      data-dragging={drag.isDragging ? "" : undefined}
      style={
        drag.offset > 0
          ? { transform: `translateY(${drag.offset}px)` }
          : undefined
      }
      aria-labelledby={titleId}
      onClose={onClosed}
      onKeyDown={(event) => cycleFocus(event, panelRef.current)}
    >
      <div ref={panelRef} className="directory-sheet-panel" tabIndex={-1}>
        <div className="directory-sheet-handle" {...drag.handlers}>
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
        </div>
        {children(close)}
      </div>
    </dialog>
  );
}
