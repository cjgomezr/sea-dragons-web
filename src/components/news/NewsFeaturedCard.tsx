import { PushPin } from "@phosphor-icons/react/dist/ssr/PushPin";
import Link from "next/link";
import { useId } from "react";
import { NEWS_POST_PATH } from "@/lib/auth/routes";
import { formatClubShortDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { NewsFeedItem, NewsPinnedFeedItem } from "@/lib/news/news-feed";
import { NewsCover } from "./NewsCover";
import { NewsAttachmentMark, NewsFeedMeta } from "./NewsFeedMeta";

/** La de arriba del feed (#594, RF-4 del PRD de E22): la fijada vigente para
 * quien mira o, sin ella, la más reciente. */
export type FeaturedPost =
  | { readonly kind: "pinned"; readonly post: NewsPinnedFeedItem }
  | { readonly kind: "latest"; readonly post: NewsFeedItem };

const PIN_ICON_SIZE = 16;

function FeaturedStatus({
  translate,
  featured,
}: {
  readonly translate: Translator;
  readonly featured: FeaturedPost;
}): React.JSX.Element {
  if (featured.kind === "latest") {
    return <p className="news-featured-status">{translate("news.latest")}</p>;
  }
  const { pinnedUntil } = featured.post;
  return (
    <p className="news-featured-status news-featured-status-pinned">
      <PushPin
        aria-hidden="true"
        focusable="false"
        size={PIN_ICON_SIZE}
        weight="fill"
        color="currentColor"
      />
      {pinnedUntil === null
        ? translate("news.featured.pinned")
        : translate("news.featured.pinnedUntil", {
            date: formatClubShortDay(translate.locale, new Date(pinnedUntil)),
          })}
    </p>
  );
}

/**
 * La tarjeta destacada: la portada grande a la izquierda. A la derecha van la
 * marca de fijada o de lo último, la línea de categoría, el título, el
 * extracto y la invitación a leerla. Como en las filas, el único enlace es el título y su `::after`
 * cubre la tarjeta; "Leer publicación" es la pista visual de que se pulsa, y
 * el lector de pantalla no la oye para no anunciar dos veces lo mismo.
 */
export function NewsFeaturedCard({
  translate,
  featured,
  now,
  isUnread,
}: {
  readonly translate: Translator;
  readonly featured: FeaturedPost;
  readonly now: Date;
  readonly isUnread: boolean;
}): React.JSX.Element {
  const titleId = useId();
  const { post } = featured;
  return (
    <article
      className={`news-featured news-featured-${featured.kind}`}
      aria-labelledby={titleId}
    >
      <div className="news-featured-cover">
        <NewsCover url={post.coverUrl} category={post.category} iconSize={88} />
      </div>
      <div className="news-featured-body">
        <FeaturedStatus translate={translate} featured={featured} />
        <NewsFeedMeta
          translate={translate}
          post={post}
          now={now}
          unreadMark={isUnread ? "dot-and-word" : "none"}
        />
        <h2 id={titleId} className="news-featured-title">
          <Link
            href={NEWS_POST_PATH.replace("[id]", post.id)}
            className="news-row-link"
          >
            {post.title}
          </Link>
        </h2>
        <p className="news-featured-excerpt">{post.excerpt}</p>
        <div className="news-featured-footer">
          <span className="news-featured-read" aria-hidden="true">
            {translate("news.featured.readPost")}
            <span> →</span>
          </span>
          <NewsAttachmentMark
            translate={translate}
            count={post.attachmentCount}
          />
        </div>
      </div>
    </article>
  );
}
