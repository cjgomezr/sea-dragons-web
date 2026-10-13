"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { NEWS_PUBLISH_PATH } from "@/lib/auth/routes";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import type { NewsFeedItem, NewsPinnedFeedItem } from "@/lib/news/news-feed";
import {
  arrangeAfterPin,
  arrangeAfterUnpin,
} from "@/lib/news/news-feed-pinning";
import { isNewsUnread, newsUnreadCutoff } from "@/lib/news/news-seen";
import {
  type NewsFailure,
  describeNewsFailure,
  loadNewsFeed,
  recordNewsVisit,
} from "./news-client";
import { type FeaturedPost, NewsFeaturedCard } from "./NewsFeaturedCard";
import { NewsFeedRow } from "./NewsFeedRow";
import type { PinControls } from "./NewsPinControls";
import { NewsPublishedNotice } from "./NewsPublishedNotice";
import { pinningOf, useNewsPinning } from "./use-news-pinning";

/**
 * El feed de noticias (#329, RF-4 del PRD de E11): lo publicado para quien
 * mira, de lo más reciente a lo más antiguo, de 20 en 20.
 *
 * Carga incremental: la pantalla guarda las filas que ya tiene y el cursor que
 * le dio el servidor, y "Cargar más" pide la página siguiente con ese cursor y
 * la añade al final. Nada se vuelve a pedir ni se reordena, así que la lista
 * no salta, y el foco pasa a la primera fila nueva para que el teclado y el
 * lector de pantalla sigan desde ahí. Es de cliente por eso mismo: cambia sin
 * recargar. Lee por la API v1, la misma que usará la aplicación nativa de
 * Release 2 (CON-002).
 *
 * Desde E22 (#594) la primera queda arriba como tarjeta destacada: la fijada
 * vigente si es para quien mira, y si no la más reciente. La lista de debajo
 * nunca la repite. Lo no leído se mide contra la visita a Noticias que trae
 * la primera página, la de antes de abrir: por eso la visita se registra
 * después de leerla, y no a la vez.
 *
 * El Admin fija y desfija desde aquí (#595) sin recargar: la que fija pasa a
 * la destacada y la que lo era vuelve a la lista en su sitio por fecha.
 */

type MoreState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: NewsFailure };

type FeedState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: NewsFailure }
  | {
      readonly kind: "ready";
      /** Sólo la trae la primera página (#592). */
      readonly pinned: NewsPinnedFeedItem | null;
      readonly posts: readonly NewsFeedItem[];
      /** Desde cuándo lo publicado cuenta como no leído, fijado al abrir. */
      readonly unreadCutoff: number;
      readonly nextCursor: string | null;
      readonly more: MoreState;
      /** La primera fila de la última página añadida, que recibe el foco.
       * Nula en la primera página: al abrir la sección el foco no se mueve. */
      readonly focusPostId: string | null;
    };

const TITLE_ID = "noticias-titulo";
const LIST_LABEL_ID = "noticias-lista";

type FeedLayout = {
  readonly featured: FeaturedPost | null;
  readonly listed: readonly NewsFeedItem[];
};

function arrangeFeed(
  pinned: NewsPinnedFeedItem | null,
  posts: readonly NewsFeedItem[],
): FeedLayout {
  if (pinned !== null) {
    return { featured: { kind: "pinned", post: pinned }, listed: posts };
  }
  const [newest, ...older] = posts;
  return newest === undefined
    ? { featured: null, listed: [] }
    : { featured: { kind: "latest", post: newest }, listed: older };
}

function LoadFailure({
  translate,
  failure,
  onRetry,
}: {
  readonly translate: Translator;
  readonly failure: NewsFailure;
  readonly onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="admin-load-failure">
      <p className="auth-error" role="alert">
        {describeNewsFailure(translate, failure, "news.error.unexpected")}
      </p>
      <button type="button" className="auth-submit" onClick={onRetry}>
        {translate("news.retry")}
      </button>
    </div>
  );
}

function LoadMore({
  translate,
  more,
  onLoadMore,
}: {
  readonly translate: Translator;
  readonly more: MoreState;
  readonly onLoadMore: () => void;
}): React.JSX.Element {
  const isLoading = more.kind === "loading";
  return (
    <div className="news-more">
      {more.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {describeNewsFailure(
            translate,
            more.failure,
            "news.error.unexpected",
          )}
        </p>
      ) : null}
      <button
        type="button"
        className="admin-secondary"
        onClick={onLoadMore}
        disabled={isLoading}
      >
        {translate(isLoading ? "news.loadingMore" : "news.loadMore")}
      </button>
    </div>
  );
}

/** Los controles de fijar de cada publicación, o nulo si quien mira no fija. */
type PinControlsFor = ((postId: string) => PinControls) | null;

function FeedPosts({
  translate,
  feed,
  now,
  pinControlsFor,
  pinFocusRequest,
}: {
  readonly translate: Translator;
  readonly feed: Extract<FeedState, { kind: "ready" }>;
  readonly now: Date;
  readonly pinControlsFor: PinControlsFor;
  readonly pinFocusRequest: number;
}): React.JSX.Element {
  const { featured, listed } = arrangeFeed(feed.pinned, feed.posts);
  if (featured === null) {
    return <p className="admin-empty">{translate("news.empty")}</p>;
  }
  return (
    <>
      <NewsFeaturedCard
        translate={translate}
        featured={featured}
        now={now}
        isUnread={isNewsUnread(featured.post, feed.unreadCutoff)}
        pinControls={pinControlsFor?.(featured.post.id) ?? null}
        pinFocusRequest={pinFocusRequest}
      />
      {listed.length > 0 ? (
        <div className="news-list-section">
          <h2 id={LIST_LABEL_ID} className="news-list-label">
            {translate(
              featured.kind === "pinned" ? "news.latest" : "news.list.earlier",
            )}
          </h2>
          <ul className="news-list" aria-labelledby={LIST_LABEL_ID}>
            {listed.map((post) => (
              <NewsFeedRow
                key={post.id}
                translate={translate}
                post={post}
                now={now}
                isUnread={isNewsUnread(post, feed.unreadCutoff)}
                shouldTakeFocus={post.id === feed.focusPostId}
                pinControls={pinControlsFor?.(post.id) ?? null}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

export function NewsFeedScreen({
  locale,
  canPublish,
  canPin,
}: {
  readonly locale: Locale;
  /** Si quien mira puede publicar (#330). Sólo decide si se pinta el botón:
   * la frontera es quien niega el formulario y el endpoint. */
  readonly canPublish: boolean;
  /** Si quien mira puede fijar (#595, D1): lo mismo, sólo pinta los botones. */
  readonly canPin: boolean;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [state, setState] = useState<FeedState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);
  const [pinFocusRequest, setPinFocusRequest] = useState(0);
  const hasRecordedVisit = useRef(false);
  const { pinning, toggleStrip, closeStrip, pin, unpin } = useNewsPinning({
    onPinned: (postId, pinnedUntil) => {
      setState((current) =>
        current.kind === "ready"
          ? { ...current, ...arrangeAfterPin(current, postId, pinnedUntil) }
          : current,
      );
      setPinFocusRequest((count) => count + 1);
    },
    onUnpinned: () => {
      setState((current) =>
        current.kind === "ready"
          ? { ...current, ...arrangeAfterUnpin(current) }
          : current,
      );
      setPinFocusRequest((count) => count + 1);
    },
  });

  useEffect(() => {
    let isCurrent = true;
    void loadNewsFeed(null).then((outcome) => {
      if (!isCurrent) {
        return;
      }
      if (outcome.kind === "failed") {
        setState({ kind: "failed", failure: outcome });
        return;
      }
      setState({
        kind: "ready",
        pinned: outcome.page.pinned,
        posts: outcome.page.posts,
        unreadCutoff: newsUnreadCutoff(outcome.page.seenAt, new Date()),
        nextCursor: outcome.page.nextCursor,
        more: { kind: "idle" },
        focusPostId: null,
      });
      // Abrir Noticias es la visita que pone a cero las sin leer del inicio
      // (#424). Una sola vez: reintentar la carga no es otra visita.
      if (!hasRecordedVisit.current) {
        hasRecordedVisit.current = true;
        void recordNewsVisit();
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [reloads]);

  function retryLoad(): void {
    setState({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  async function loadMore(cursor: string): Promise<void> {
    setState((current) =>
      current.kind === "ready"
        ? { ...current, more: { kind: "loading" } }
        : current,
    );
    const outcome = await loadNewsFeed(cursor);
    setState((current) => {
      if (current.kind !== "ready") {
        return current;
      }
      if (outcome.kind === "failed") {
        return { ...current, more: { kind: "failed", failure: outcome } };
      }
      return {
        ...current,
        posts: [...current.posts, ...outcome.page.posts],
        nextCursor: outcome.page.nextCursor,
        more: { kind: "idle" },
        focusPostId: outcome.page.posts.at(0)?.id ?? null,
      };
    });
  }

  const now = new Date();
  const nextCursor = state.kind === "ready" ? state.nextCursor : null;
  const hasPinned = state.kind === "ready" && state.pinned !== null;
  const pinControlsFor: PinControlsFor = canPin
    ? (postId) => ({
        pinning: pinningOf(pinning, postId),
        replacesPinned: hasPinned,
        onToggleStrip: () => toggleStrip(postId),
        onCloseStrip: closeStrip,
        onChoose: (duration) => void pin(postId, duration),
        onUnpin: () => void unpin(postId),
      })
    : null;

  return (
    <div className="news">
      <header className="news-header">
        <div>
          <p className="news-eyebrow">{translate("news.eyebrow")}</p>
          <h1 id={TITLE_ID}>{translate("news.title")}</h1>
        </div>
        {canPublish ? (
          <Link
            href={NEWS_PUBLISH_PATH}
            className="auth-submit news-publish-link"
          >
            {translate("news.publish")}
          </Link>
        ) : null}
      </header>
      <NewsPublishedNotice translate={translate} />
      {state.kind === "loading" ? (
        <p className="admin-empty">{translate("news.loading")}</p>
      ) : null}
      {state.kind === "failed" ? (
        <LoadFailure
          translate={translate}
          failure={state.failure}
          onRetry={retryLoad}
        />
      ) : null}
      {state.kind === "ready" ? (
        <FeedPosts
          translate={translate}
          feed={state}
          now={now}
          pinControlsFor={pinControlsFor}
          pinFocusRequest={pinFocusRequest}
        />
      ) : null}
      {state.kind === "ready" && nextCursor !== null ? (
        <LoadMore
          translate={translate}
          more={state.more}
          onLoadMore={() => void loadMore(nextCursor)}
        />
      ) : null}
    </div>
  );
}
