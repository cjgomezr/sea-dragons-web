import Link from "next/link";
import { useEffect, useRef } from "react";
import { AttachmentIcon } from "@/components/NavIcons";
import { NEWS_POST_PATH } from "@/lib/auth/routes";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { NewsFeedItem } from "@/lib/news/news-feed";
import { NewsCategoryLabel } from "./NewsCategoryLabel";

/**
 * Una fila del feed (#329): categoría, hace cuánto, autor, título, extracto y
 * la marca de adjuntos. El enlace es sólo el título, para que un lector de
 * pantalla anuncie cada fila con su título y nada más; la tarjeta entera se
 * pulsa porque el enlace la cubre por CSS.
 */
export function NewsFeedRow({
  translate,
  post,
  now,
  shouldTakeFocus,
}: {
  readonly translate: Translator;
  readonly post: NewsFeedItem;
  readonly now: Date;
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
      <p className="news-row-meta">
        <NewsCategoryLabel translate={translate} category={post.category} />
        <span className="news-row-byline">
          <time dateTime={post.publishedAt}>
            {formatRelativeTime(
              translate.locale,
              new Date(post.publishedAt),
              now,
            )}
          </time>
          <span aria-hidden="true"> · </span>
          <span>{post.author.fullName}</span>
        </span>
      </p>
      <h2 className="news-row-title">
        <Link
          ref={linkRef}
          href={NEWS_POST_PATH.replace("[id]", post.id)}
          className="news-row-link"
        >
          {post.title}
        </Link>
      </h2>
      <p className="news-row-excerpt">{post.excerpt}</p>
      {post.attachmentCount > 0 ? (
        <p className="news-attachment-mark">
          <AttachmentIcon />
          <span aria-hidden="true">{post.attachmentCount}</span>
          <span className="visually-hidden">
            {translate("news.attachmentCount", {
              count: post.attachmentCount,
            })}
          </span>
        </p>
      ) : null}
    </li>
  );
}
