"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { MemberPhotoDialog } from "@/components/MemberPhotoDialog";
import { memberInitials } from "@/lib/auth/member-initials";
import type { Translator } from "@/lib/i18n/translator";

/**
 * El círculo de un miembro (#245): su foto cuando la tiene, y si no sus
 * iniciales, como hasta ahora. Lo comparten la cabecera del perfil y cada
 * fila del directorio, que sólo cambian el tamaño con su clase.
 *
 * `unoptimized` a propósito: la foto llega con una dirección firmada de vida
 * corta, y el optimizador de Next la pediría sin esa firma o guardaría en su
 * caché una copia que la firma ya no protege.
 *
 * Por defecto la foto es decorativa, igual que las iniciales, porque donde va
 * el nombre ya está escrito al lado. Con `alt` se anuncia, como en la
 * cabecera del perfil, donde es la foto propia la que se cambia.
 *
 * Una foto que no carga (la firma caducó, el fichero ya no está) cae a las
 * iniciales en vez de dejar un icono roto (#354). Se recuerda qué dirección
 * falló, no sólo que falló: una dirección nueva se vuelve a intentar.
 *
 * Con `viewer`, la foto es además un botón que la abre en grande (#355). Las
 * iniciales nunca lo son: no hay nada más grande que enseñar.
 */

/** Lo que hace falta para abrir la foto en grande. */
export type PhotoViewer = {
  /** El `user_id` del socio, con el que se pide su foto grande. */
  readonly userId: string;
  readonly translate: Translator;
};

export function MemberAvatar({
  fullName,
  photoUrl,
  size,
  className,
  alt = "",
  viewer,
}: {
  fullName: string;
  photoUrl: string | null;
  /** En píxeles; el CSS de la clase tiene que decir lo mismo. */
  size: number;
  className: string;
  alt?: string;
  viewer?: PhotoViewer;
}): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (photoUrl === null || photoUrl === failedUrl) {
    return (
      <span className={className} aria-hidden="true">
        {memberInitials(fullName)}
      </span>
    );
  }
  const photo = (
    <Image
      className={`${className} member-photo`}
      src={photoUrl}
      alt={alt}
      width={size}
      height={size}
      unoptimized
      onError={() => setFailedUrl(photoUrl)}
    />
  );
  if (viewer === undefined) {
    return photo;
  }
  return (
    <ExpandablePhoto viewer={viewer} fullName={fullName} photoUrl={photoUrl}>
      {photo}
    </ExpandablePhoto>
  );
}

function ExpandablePhoto({
  viewer,
  fullName,
  photoUrl,
  children,
}: {
  viewer: PhotoViewer;
  fullName: string;
  photoUrl: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function returnFocus(): void {
    setIsOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="member-photo-button"
        aria-label={viewer.translate("photoViewer.open", { name: fullName })}
        aria-haspopup="dialog"
        onClick={() => setIsOpen(true)}
      >
        {children}
      </button>
      {isOpen ? (
        <MemberPhotoDialog
          translate={viewer.translate}
          userId={viewer.userId}
          fullName={fullName}
          thumbnailUrl={photoUrl}
          onClosed={returnFocus}
        />
      ) : null}
    </>
  );
}
