"use client";

import Image from "next/image";
import { useState } from "react";
import { memberInitials } from "@/lib/auth/member-initials";

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
 */
export function MemberAvatar({
  fullName,
  photoUrl,
  size,
  className,
  alt = "",
}: {
  fullName: string;
  photoUrl: string | null;
  /** En píxeles; el CSS de la clase tiene que decir lo mismo. */
  size: number;
  className: string;
  alt?: string;
}): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (photoUrl === null || photoUrl === failedUrl) {
    return (
      <span className={className} aria-hidden="true">
        {memberInitials(fullName)}
      </span>
    );
  }
  return (
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
}
