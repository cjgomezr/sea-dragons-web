"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import type { NewsFeedItem } from "@/lib/news/news-feed";
import {
  type NewsFailure,
  describeNewsFailure,
  loadNewsFeed,
} from "./news-client";
import { NewsFeedRow } from "./NewsFeedRow";

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
      readonly posts: readonly NewsFeedItem[];
      readonly nextCursor: string | null;
      readonly more: MoreState;
      /** La primera fila de la última página añadida, que recibe el foco.
       * Nula en la primera página: al abrir la sección el foco no se mueve. */
      readonly focusPostId: string | null;
    };

const TITLE_ID = "noticias-titulo";

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

export function NewsFeedScreen({
  locale,
}: {
  readonly locale: Locale;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [state, setState] = useState<FeedState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadNewsFeed(null).then((outcome) => {
      if (!isCurrent) {
        return;
      }
      setState(
        outcome.kind === "loaded"
          ? {
              kind: "ready",
              posts: outcome.page.posts,
              nextCursor: outcome.page.nextCursor,
              more: { kind: "idle" },
              focusPostId: null,
            }
          : { kind: "failed", failure: outcome },
      );
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
        kind: "ready",
        posts: [...current.posts, ...outcome.page.posts],
        nextCursor: outcome.page.nextCursor,
        more: { kind: "idle" },
        focusPostId: outcome.page.posts.at(0)?.id ?? null,
      };
    });
  }

  const now = new Date();
  const nextCursor = state.kind === "ready" ? state.nextCursor : null;

  return (
    <div className="news">
      <header className="news-header">
        <p className="news-eyebrow">{translate("news.eyebrow")}</p>
        <h1 id={TITLE_ID}>{translate("news.title")}</h1>
      </header>
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
      {state.kind === "ready" && state.posts.length === 0 ? (
        <p className="admin-empty">{translate("news.empty")}</p>
      ) : null}
      {state.kind === "ready" && state.posts.length > 0 ? (
        <ul className="news-list" aria-labelledby={TITLE_ID}>
          {state.posts.map((post) => (
            <NewsFeedRow
              key={post.id}
              translate={translate}
              post={post}
              now={now}
              shouldTakeFocus={post.id === state.focusPostId}
            />
          ))}
        </ul>
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
