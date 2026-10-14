import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Markdown, {
  type Components,
  type ExtraProps,
  type UrlTransform,
} from "react-markdown";
import remarkBreaks from "remark-breaks";
import { readNewsInlineImageId } from "@/lib/news/news-inline-image-urls";
import {
  NEWS_REMARK_PLUGINS,
  isExternalNewsLinkUrl,
  isSafeNewsLinkUrl,
} from "@/lib/news/news-markdown";

/**
 * El cuerpo de una noticia pintado como Markdown (#593, RF-6 del PRD de E22).
 *
 * Sin `rehype-raw`, react-markdown convierte el HTML crudo en texto: se ve lo
 * que se escribió y no se crea ningún elemento. De las imágenes sólo se
 * pintan las del club (#603), que pasan por la API y su regla de audiencia;
 * una de fuera no se carga. `remark-breaks` respeta cada salto simple, así
 * las publicaciones de texto plano se ven como antes (D9).
 */

const REMARK_PLUGINS = [...NEWS_REMARK_PLUGINS, remarkBreaks];

/** Un href que no pasa la lista blanca se quita: el enlace queda en su texto.
 * Una imagen sólo conserva su dirección si es del club. */
const keepSafeUrl: UrlTransform = (url, key) => {
  if (key === "src") {
    return readNewsInlineImageId(url) === null ? null : url;
  }
  return isSafeNewsLinkUrl(url) ? url : null;
};

function NewsLink({
  href,
  title,
  children,
}: ComponentPropsWithoutRef<"a"> & ExtraProps): ReactNode {
  if (href === undefined) {
    return children;
  }
  if (!isExternalNewsLinkUrl(href)) {
    return (
      <a href={href} title={title}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} title={title} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** Spans y no `figure`: Markdown pone la imagen dentro de un párrafo, y un
 * bloque ahí dentro no es HTML válido. El pie repite el texto alternativo,
 * así que el lector de pantalla no lo lee dos veces. Es un `img` y no
 * `next/image` porque la dirección es de la API, que redirige a una firmada:
 * no hay nada que optimizar. */
function NewsBodyImage({
  src,
  alt,
}: ComponentPropsWithoutRef<"img"> & ExtraProps): ReactNode {
  if (typeof src !== "string") {
    return null;
  }
  const caption = alt === undefined ? "" : alt.trim();
  return (
    <span className="news-body-image">
      {/* eslint-disable-next-line @next/next/no-img-element -- ver el comentario del componente. */}
      <img src={src} alt={caption} loading="lazy" />
      {caption === "" ? null : (
        <span className="news-body-image-caption" aria-hidden="true">
          {caption}
        </span>
      )}
    </span>
  );
}

const COMPONENTS: Components = { a: NewsLink, img: NewsBodyImage };

export function NewsMarkdown({ body }: { readonly body: string }): ReactNode {
  return (
    <div className="news-markdown">
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        urlTransform={keepSafeUrl}
        components={COMPONENTS}
      >
        {body}
      </Markdown>
    </div>
  );
}
