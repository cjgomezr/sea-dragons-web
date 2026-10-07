"use client";

import { useEffect, useId, useRef } from "react";

/**
 * Un `<dialog>` modal con las clases del diálogo del calendario (#382): el
 * navegador trae el rol, la capa modal y lo que queda detrás inerte. Lo usan
 * la exención de cuota (#457) y el correo del directorio (#501).
 *
 * Mientras guarda no se cierra con Escape: lo que el servidor responda tiene
 * que verse aquí.
 */
export function ModalDialog({
  title,
  isSending,
  onClosed,
  children,
}: {
  readonly title: string;
  readonly isSending: boolean;
  /** Ya cerrado: quien lo abrió lo desmonta. */
  readonly onClosed: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="event-dialog"
      aria-labelledby={titleId}
      onClose={onClosed}
      // Escape cierra salvo mientras guarda, como el diálogo del calendario.
      onCancel={(event) => {
        if (isSending) {
          event.preventDefault();
        }
      }}
    >
      <div className="event-dialog-panel">
        <div className="event-dialog-header">
          <h2 id={titleId} className="event-dialog-title">
            {title}
          </h2>
        </div>
        <div className="event-dialog-body">{children}</div>
      </div>
    </dialog>
  );
}
