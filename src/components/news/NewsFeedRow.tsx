import Link from "next/link";
import { useEffect, useRef } from "react";
import { NEWS_POST_PATH } from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import type { NewsFeedItem } from "@/lib/news/news-feed";
import { NewsCover } from "./NewsCover";
import { NewsAttachmentMark, NewsFeedMeta } from "./NewsFeedMeta";

/**
 * Una fila de la lista del feed (#329, rehecha en #594): la miniatura de la
 * portada o el fondo de su categoría, y al lado la línea de categoría, el
 * título y una línea de extracto. El enlace es sólo el título, para que un
 * lector de pantalla anuncie cada fila con su título y nada más; la fila
 * entera se pulsa porque el enlace la cubre por CSS.
 */
export function NewsFeedRow({
  translate,
  post,
  now,
  isUnread,
  shouldTakeFocus,
}: {
  readonly translate: Translator;
  readonly post: NewsFeedItem;
  readonly now: Date;
  readonly isUnread: boolean;
  /** La primera fila de una página recién cargada: recibe el foco para que
   * quien pulsó "Cargar más" siga leyendo desde ahí. */
  readonly shouldTakeFocus: boolean;
}): React.JSX.Element {
  const linkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (shouldTakeFocus) {
      linkRef.current?.focus();
    }
  }, [shouldTakeFocus]);

  return (
    <li className="news-row">
      <div className="news-row-thumbnail">
        <NewsCover
          url={post.coverThumbnailUrl}
          category={post.category}
          iconSize={32}
        />
      </div>
      <div className="news-row-body">
        <NewsFeedMeta
          translate={translate}
          post={post}
          now={now}
          unreadMark={isUnread ? "dot" : "none"}
        >
          <NewsAttachmentMark
            translate={translate}
            count={post.attachmentCount}
          />
        </NewsFeedMeta>
        <h3 className="news-row-title">
          <Link
            ref={linkRef}
            href={NEWS_POST_PATH.replace("[id]", post.id)}
            className="news-row-link"
          >
            {post.title}
          </Link>
        </h3>
        <p className="news-row-excerpt">{post.excerpt}</p>
      </div>
    </li>
  );
}
