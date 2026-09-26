"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useDismissal } from "@/components/use-dismissal";
import type { Translator } from "@/lib/i18n/translator";
import { fetchLargeMemberPhoto } from "./member-photo-client";

/**
 * La foto de perfil en grande (#355), en un `<dialog>` modal encima de la
 * pantalla. El `<dialog>` nativo trae el rol, la capa modal y lo que queda
 * detrás inerte; `useDismissal` pone lo que comparte con los avisos y el menú
 * de la cuenta: Escape, el clic fuera y el foco que no se escapa.
 *
 * La versión grande se pide al abrir y se olvida al cerrar: la dirección
 * firmada vive lo que vive el diálogo. Mientras llega se ve la miniatura
 * ampliada, que ya estaba descargada, con un aviso de que carga.
 *
 * `<img>` y no `next/image`: el tamaño natural de la foto no se sabe hasta
 * que llega, y el optimizador de Next la pediría sin la firma.
 */

type LargePhoto =
  | { readonly kind: "loading" }
  | {
      readonly kind: "found";
      readonly photoUrl: string;
      /** Si ya se pintó: hasta entonces sigue la miniatura. */
      readonly isLoaded: boolean;
    }
  | { readonly kind: "unavailable" };

function useLargePhoto(userId: string): {
  readonly photo: LargePhoto;
  readonly markLoaded: () => void;
  readonly markFailed: () => void;
} {
  const [photo, setPhoto] = useState<LargePhoto>({ kind: "loading" });
  useEffect(() => {
    let isCurrent = true;
    void fetchLargeMemberPhoto(userId).then((result) => {
      if (isCurrent) {
        setPhoto(
          result.kind === "found"
            ? { kind: "found", photoUrl: result.photoUrl, isLoaded: false }
            : result,
        );
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [userId]);
  const markLoaded = useCallback(
    () =>
      setPhoto((current) =>
        current.kind === "found" ? { ...current, isLoaded: true } : current,
      ),
    [],
  );
  const markFailed = useCallback(() => setPhoto({ kind: "unavailable" }), []);
  return { photo, markLoaded, markFailed };
}

function LargePhotoFrame({
  translate,
  fullName,
  thumbnailUrl,
  userId,
}: {
  readonly translate: Translator;
  readonly fullName: string;
  readonly thumbnailUrl: string;
  readonly userId: string;
}): React.JSX.Element {
  const { photo, markLoaded, markFailed } = useLargePhoto(userId);
  if (photo.kind === "unavailable") {
    return (
      <p role="alert" className="photo-viewer-error">
        {translate("photoViewer.failed")}
      </p>
    );
  }
  const isShown = photo.kind === "found" && photo.isLoaded;
  return (
    <div className="photo-viewer-frame">
      {isShown ? null : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- ver el comentario del componente. */}
          <img
            className="photo-viewer-image photo-viewer-placeholder"
            src={thumbnailUrl}
            alt=""
          />
          <p role="status" className="photo-viewer-loading">
            {translate("photoViewer.loading")}
          </p>
        </>
      )}
      {photo.kind === "found" ? (
        // eslint-disable-next-line @next/next/no-img-element -- ver el comentario del componente.
        <img
          className={`photo-viewer-image${isShown ? "" : " is-loading"}`}
          src={photo.photoUrl}
          alt={translate("photoViewer.alt", { name: fullName })}
          onLoad={markLoaded}
          onError={markFailed}
        />
      ) : null}
    </div>
  );
}

export function MemberPhotoDialog({
  translate,
  userId,
  fullName,
  thumbnailUrl,
  onClosed,
}: {
  readonly translate: Translator;
  /** El `user_id` del socio, para pedir su foto grande. */
  readonly userId: string;
  readonly fullName: string;
  /** La miniatura que ya se ve en la lista: el relleno mientras carga. */
  readonly thumbnailUrl: string;
  /** Ya cerrado: quien lo abrió recupera el foco y lo desmonta. */
  readonly onClosed: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    closeButtonRef.current?.focus();
  }, []);

  // Todo cierre pasa por aquí, y el evento `close` del diálogo avisa: así
  // también cuenta el que hace el propio navegador (el botón atrás de
  // Android).
  const close = useCallback(() => dialogRef.current?.close(), []);
  const pressOutside = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      close();
    },
    [close],
  );
  // Con el diálogo abierto lo de detrás es inerte en el navegador; esto
  // cubre lo que quede fuera de esa garantía. Cerrado, el foco ya vuelve a
  // la foto y no se retiene.
  const keepFocusInside = useCallback(() => {
    if (dialogRef.current?.open === true) {
      closeButtonRef.current?.focus();
    }
  }, []);
  useDismissal({
    isOpen: true,
    containerRef: panelRef,
    onEscape: close,
    onPressOutside: pressOutside,
    onFocusOutside: keepFocusInside,
  });

  return (
    <dialog
      ref={dialogRef}
      className="photo-viewer"
      aria-labelledby={titleId}
      onClose={onClosed}
    >
      <div ref={panelRef} className="photo-viewer-panel">
        <div className="photo-viewer-header">
          <h2 id={titleId} className="photo-viewer-title">
            {fullName}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="photo-viewer-close"
            aria-label={translate("photoViewer.close")}
            onClick={close}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <LargePhotoFrame
          translate={translate}
          fullName={fullName}
          thumbnailUrl={thumbnailUrl}
          userId={userId}
        />
      </div>
    </dialog>
  );
}
