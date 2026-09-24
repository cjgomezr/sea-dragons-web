"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * El logo del club donde antes iba el recuadro de iniciales (#295, RF-4 del
 * PRD de E18a). Sin logo, o con uno que ya no está en el almacenamiento, se
 * pinta `fallback`: las iniciales, o nada donde nunca las hubo.
 *
 * Es de cliente sólo para enterarse de que la imagen no cargó. Un `<img>`
 * normal y no `next/image`: el logo tiene la proporción que el club quiera,
 * y `next/image` exige conocer el ancho y el alto de antemano.
 */
export function ClubBrandMark({
  logoUrl,
  logoAlt,
  fallback,
}: {
  logoUrl: string | null;
  logoAlt: string;
  fallback: ReactNode;
}): React.JSX.Element {
  // Se guarda la dirección que falló, no un sí o no: un logo nuevo vuelve a
  // intentarse sin tener que reiniciar nada.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const image = useRef<HTMLImageElement>(null);

  // Una imagen que falla antes de que React hidrate la página no dispara
  // `onError`: el navegador ya la dio por rota. Se mira una vez montada.
  useEffect(() => {
    const element = image.current;
    if (element !== null && element.complete && element.naturalWidth === 0) {
      setBrokenUrl(logoUrl);
    }
  }, [logoUrl]);

  if (logoUrl === null || logoUrl === brokenUrl) {
    return <>{fallback}</>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- ver el comentario del componente.
    <img
      ref={image}
      className="club-logo"
      src={logoUrl}
      alt={logoAlt}
      onError={() => setBrokenUrl(logoUrl)}
    />
  );
}
