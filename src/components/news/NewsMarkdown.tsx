import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import {
  isExternalNewsLinkUrl,
  isSafeNewsLinkUrl,
} from "@/lib/news/news-markdown";

/**
 * El cuerpo de una noticia pintado como Markdown (#593, RF-6 del PRD de E22).
 *
 * Sin `rehype-raw`, react-markdown convierte el HTML crudo en texto: se ve lo
 * que se escribió y no se crea ningún elemento. Las imágenes del club llegan
 * con el #603; hasta entonces no se pinta ninguna, para no cargar nada de
 * fuera. `remark-breaks` respeta cada salto simple, así las publicaciones de
 * texto plano se ven como antes (D9).
 */

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];
const DISALLOWED_ELEMENTS = ["img"];

/** Un href que no pasa la lista blanca se quita: el enlace queda en su texto. */
function keepSafeUrl(url: string): string | null {
  return isSafeNewsLinkUrl(url) ? url : null;
}

function NewsLink({
  href,
  children,
}: ComponentPropsWithoutRef<"a"> & ExtraProps): ReactNode {
  if (href === undefined) {
    return children;
  }
  if (!isExternalNewsLinkUrl(href)) {
    return <a href={href}>{children}</a>;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

const COMPONENTS: Components = { a: NewsLink };

export function NewsMarkdown({ body }: { readonly body: string }): ReactNode {
  return (
    <div className="news-markdown">
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        urlTransform={keepSafeUrl}
        disallowedElements={DISALLOWED_ELEMENTS}
        components={COMPONENTS}
      >
        {body}
      </Markdown>
    </div>
  );
}
