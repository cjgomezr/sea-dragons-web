import { AttachmentIcon } from "@/components/NavIcons";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { NewsFeedItem } from "@/lib/news/news-feed";
import { NewsCategoryLabel } from "./NewsCategoryLabel";

export type UnreadMark = "none" | "dot" | "dot-and-word";

/**
 * La línea de encima del título, en la tarjeta destacada y en cada fila del
 * feed (#594): categoría, el punto de no leída, si está retirada, y hace
 * cuánto y quién. Una retirada sólo le llega a quien la publicó (#331).
 *
 * Lo no leído nunca se cuenta sólo con el color del punto: la destacada
 * escribe "Nueva" al lado, y en la fila la palabra la oye el lector de
 * pantalla.
 */
export function NewsFeedMeta({
  translate,
  post,
  now,
  unreadMark,
  children,
}: {
  readonly translate: Translator;
  readonly post: NewsFeedItem;
  readonly now: Date;
  readonly unreadMark: UnreadMark;
  /** Lo que va al final de la línea, como la marca de adjuntos de la fila. */
  readonly children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <p className="news-row-meta">
      <NewsCategoryLabel translate={translate} category={post.category} />
      {unreadMark === "none" ? null : (
        <span className="news-unread">
          <span className="news-unread-dot" aria-hidden="true" />
          <span
            className={unreadMark === "dot" ? "visually-hidden" : undefined}
          >
            {translate("news.unread")}
          </span>
        </span>
      )}
      {post.status === "withdrawn" ? (
        <span className="news-withdrawn">
          {translate("news.post.withdrawn")}
        </span>
      ) : null}
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
      {children}
    </p>
  );
}

/** El clip con el número de adjuntos. Sin adjuntos no se pinta. */
export function NewsAttachmentMark({
  translate,
  count,
}: {
  readonly translate: Translator;
  readonly count: number;
}): React.JSX.Element | null {
  if (count === 0) {
    return null;
  }
  return (
    <span className="news-attachment-mark">
      <AttachmentIcon />
      <span aria-hidden="true">{count}</span>
      <span className="visually-hidden">
        {translate("news.attachmentCount", { count })}
      </span>
    </span>
  );
}
