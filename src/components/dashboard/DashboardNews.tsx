import { LockSimple } from "@phosphor-icons/react/dist/ssr/LockSimple";
import { PushPin } from "@phosphor-icons/react/dist/ssr/PushPin";
import Link from "next/link";
import { useId } from "react";
import { NewsCategoryLabel } from "@/components/news/NewsCategoryLabel";
import { NewsCover } from "@/components/news/NewsCover";
import { NEWS_PATH, NEWS_POST_PATH, PAYMENTS_PATH } from "@/lib/auth/routes";
import type {
  LatestNews,
  LatestNewsItem,
  MemberLatestNewsItem,
} from "@/lib/dashboard/dashboard";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Las noticias del inicio (#751, RF-7, D2 y D7 del PRD de E27;
 * docs/design/design_handoff_dashboard, sección News). Al socio al día, la
 * destacada (la fijada o la más nueva) con su portada o el fondo de su
 * categoría (E22), y las otras en pequeño con miniatura y el punto de sin
 * leer. A quien no tiene la membresía al día, la fila del candado y sólo los
 * títulos, que lo llevan a Pagos como le pasaría al abrir Noticias.
 *
 * Como en el feed, el único enlace de cada noticia es su título, y su
 * `::after` cubre la tarjeta: el lector de pantalla oye el título una vez.
 */

const PIN_ICON_SIZE = 14;
const LOCK_ICON_SIZE = 18;
const FEATURED_FALLBACK_ICON_SIZE = 64;
const MINI_FALLBACK_ICON_SIZE = 32;

type NewsSectionProps<Item> = {
  readonly translate: Translator;
  readonly news: LatestNews<Item>;
  /** El instante con el que se calcula "hace N". */
  readonly now: Date;
  /** Vuelve a pedir el inicio cuando las noticias no se pudieron leer. */
  readonly onRetry: () => void;
};

function postPath(id: string): string {
  return NEWS_POST_PATH.replace("[id]", encodeURIComponent(id));
}

function NewsSection({
  translate,
  allHref,
  children,
}: {
  readonly translate: Translator;
  readonly allHref: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const titleId = useId();
  return (
    <section className="dashboard-news" aria-labelledby={titleId}>
      <header className="dashboard-panel-header">
        <h2 id={titleId}>{translate("dashboard.news.title")}</h2>
        <Link href={allHref} className="dashboard-panel-all">
          {translate("dashboard.news.all")}
          <span aria-hidden="true"> →</span>
        </Link>
      </header>
      {children}
    </section>
  );
}

function NewsUnavailable({
  translate,
  onRetry,
}: Pick<NewsSectionProps<never>, "translate" | "onRetry">): React.JSX.Element {
  return (
    <div className="dashboard-news-unavailable">
      <p>{translate("dashboard.news.unavailable")}</p>
      <button type="button" className="admin-secondary" onClick={onRetry}>
        {translate("dashboard.retry")}
      </button>
    </div>
  );
}

function NewsEmpty({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  return (
    <p className="dashboard-news-empty">{translate("dashboard.news.empty")}</p>
  );
}

/** "{categoría} · {hace cuánto}". */
function NewsMeta({
  translate,
  post,
  now,
}: {
  readonly translate: Translator;
  readonly post: LatestNewsItem;
  readonly now: Date;
}): React.JSX.Element {
  return (
    <>
      <NewsCategoryLabel translate={translate} category={post.category} />
      <span aria-hidden="true"> · </span>
      <time dateTime={post.publishedAt}>
        {formatRelativeTime(translate.locale, new Date(post.publishedAt), now)}
      </time>
    </>
  );
}

function PinnedMark({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  return (
    <span className="dashboard-news-pinned">
      <PushPin
        aria-hidden="true"
        focusable="false"
        size={PIN_ICON_SIZE}
        weight="fill"
        color="currentColor"
      />
      {translate("news.featured.pinned")}
    </span>
  );
}

function FeaturedNews({
  translate,
  post,
  now,
}: {
  readonly translate: Translator;
  readonly post: MemberLatestNewsItem;
  readonly now: Date;
}): React.JSX.Element {
  const titleId = useId();
  return (
    <article className="dashboard-news-featured" aria-labelledby={titleId}>
      <div className="dashboard-news-featured-cover">
        <NewsCover
          url={post.coverUrl}
          category={post.category}
          iconSize={FEATURED_FALLBACK_ICON_SIZE}
        />
      </div>
      <div className="dashboard-news-featured-body">
        <p className="dashboard-news-meta">
          {post.isPinned ? <PinnedMark translate={translate} /> : null}
          <NewsMeta translate={translate} post={post} now={now} />
        </p>
        <h3 id={titleId} className="dashboard-news-featured-title">
          <Link href={postPath(post.id)} className="dashboard-news-link">
            {post.title}
          </Link>
        </h3>
        {post.excerpt === "" ? null : (
          <p className="dashboard-news-excerpt">{post.excerpt}</p>
        )}
      </div>
    </article>
  );
}

function MiniNews({
  translate,
  post,
  now,
}: {
  readonly translate: Translator;
  readonly post: MemberLatestNewsItem;
  readonly now: Date;
}): React.JSX.Element {
  return (
    <li className="dashboard-news-mini">
      <div className="dashboard-news-thumbnail">
        <NewsCover
          url={post.coverUrl}
          category={post.category}
          iconSize={MINI_FALLBACK_ICON_SIZE}
        />
      </div>
      <div className="dashboard-news-mini-body">
        <p className="dashboard-news-meta">
          <NewsMeta translate={translate} post={post} now={now} />
        </p>
        <h3 className="dashboard-news-mini-title">
          <Link href={postPath(post.id)} className="dashboard-news-link">
            {post.title}
          </Link>
        </h3>
      </div>
      {post.isUnread ? (
        <span className="dashboard-news-unread">
          <span className="dashboard-news-unread-dot" aria-hidden="true" />
          <span className="visually-hidden">
            {translate("dashboard.news.unread")}
          </span>
        </span>
      ) : null}
    </li>
  );
}

/** La fijada va destacada aunque no sea la más nueva; las demás, en orden. */
function splitFeatured(posts: readonly MemberLatestNewsItem[]): {
  readonly featured: MemberLatestNewsItem;
  readonly minis: readonly MemberLatestNewsItem[];
} | null {
  const featured = posts.find((post) => post.isPinned) ?? posts[0];
  if (featured === undefined) {
    return null;
  }
  return { featured, minis: posts.filter((post) => post !== featured) };
}

function MemberNewsGrid({
  translate,
  posts,
  now,
}: {
  readonly translate: Translator;
  readonly posts: readonly MemberLatestNewsItem[];
  readonly now: Date;
}): React.JSX.Element {
  const split = splitFeatured(posts);
  if (split === null) {
    return <NewsEmpty translate={translate} />;
  }
  const { featured, minis } = split;
  return (
    <div className="dashboard-news-grid">
      <FeaturedNews translate={translate} post={featured} now={now} />
      {minis.length > 0 ? (
        <ul className="dashboard-news-minis">
          {minis.map((post) => (
            <MiniNews
              key={post.id}
              translate={translate}
              post={post}
              now={now}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function DashboardNews({
  translate,
  news,
  now,
  onRetry,
}: NewsSectionProps<MemberLatestNewsItem>): React.JSX.Element {
  return (
    <NewsSection translate={translate} allHref={NEWS_PATH}>
      {news.kind === "unavailable" ? (
        <NewsUnavailable translate={translate} onRetry={onRetry} />
      ) : (
        <MemberNewsGrid translate={translate} posts={news.posts} now={now} />
      )}
    </NewsSection>
  );
}

function LockedNewsRow({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  return (
    <div className="dashboard-next-up-locked">
      <LockSimple aria-hidden="true" focusable="false" size={LOCK_ICON_SIZE} />
      <p>{translate("dashboard.news.locked")}</p>
      <Link href={PAYMENTS_PATH} className="dashboard-next-up-row-link">
        {translate("dashboard.news.renew")}
      </Link>
    </div>
  );
}

function RestrictedNewsList({
  translate,
  posts,
  now,
}: {
  readonly translate: Translator;
  readonly posts: readonly LatestNewsItem[];
  readonly now: Date;
}): React.JSX.Element {
  if (posts.length === 0) {
    return <NewsEmpty translate={translate} />;
  }
  return (
    <ul className="dashboard-news-titles">
      {posts.map((post) => (
        <li key={post.id} className="dashboard-news-title-row">
          <p className="dashboard-news-meta">
            <NewsMeta translate={translate} post={post} now={now} />
          </p>
          <Link href={PAYMENTS_PATH} className="dashboard-news-link">
            {post.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function DashboardRestrictedNews({
  translate,
  news,
  now,
  onRetry,
}: NewsSectionProps<LatestNewsItem>): React.JSX.Element {
  return (
    <NewsSection translate={translate} allHref={PAYMENTS_PATH}>
      {news.kind === "unavailable" ? (
        <NewsUnavailable translate={translate} onRetry={onRetry} />
      ) : (
        <>
          <LockedNewsRow translate={translate} />
          <RestrictedNewsList
            translate={translate}
            posts={news.posts}
            now={now}
          />
        </>
      )}
    </NewsSection>
  );
}
