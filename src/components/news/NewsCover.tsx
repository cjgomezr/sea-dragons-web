import { useState } from "react";
import type { NewsCategory } from "@/lib/news/news-posts";
import {
  type FallbackIconSize,
  NewsCategoryFallback,
} from "./NewsCategoryFallback";

/**
 * La portada de una publicación (#591) o, sin ella, el fondo de su categoría
 * (#590). Es decorativa: el título, al lado, ya nombra la publicación.
 *
 * Un `<img>` y no `next/image`, como la foto del miembro: la dirección es
 * firmada y de vida corta, y el optimizador de Next la pediría sin la firma o
 * guardaría una copia que la firma ya no protege. Una portada que no carga
 * (la firma caducó, el fichero ya no está) cae al fondo de la categoría en
 * vez de dejar un icono roto. Se recuerda qué dirección falló: una nueva se
 * vuelve a intentar.
 */
export function NewsCover({
  url,
  category,
  iconSize,
}: {
  readonly url: string | null;
  readonly category: NewsCategory;
  readonly iconSize: FallbackIconSize;
}): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (url === null || url === failedUrl) {
    return <NewsCategoryFallback category={category} iconSize={iconSize} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- ver el comentario del componente.
    <img
      className="news-cover-image"
      src={url}
      alt=""
      onError={() => setFailedUrl(url)}
    />
  );
}
