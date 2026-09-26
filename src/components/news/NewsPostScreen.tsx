"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { NEWS_PATH } from "@/lib/auth/routes";
import { formatClubMoment } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import type { NewsPostDetail } from "@/lib/news/news-posts";
import {
  type NewsFailure,
  describeNewsFailure,
  loadNewsPost,
} from "./news-client";
import { NewsAttachmentList } from "./NewsAttachmentList";
import { NewsCategoryLabel } from "./NewsCategoryLabel";

/**
 * Una publicación abierta (#329, RF-5 del PRD de E11): el cuerpo entero, el
 * autor, la fecha, si se editó y sus adjuntos.
 *
 * El cuerpo es texto plano: React lo escapa, así que una etiqueta HTML sale
 * tal cual, y los saltos de línea los respeta el CSS. Lo que no le corresponde
 * a quien mira llega del servidor como 404, igual que lo que no existe, y aquí
 * se pinta la misma pantalla para los dos: ninguna pista de que exista. Es de
 * cliente porque lee por la API v1, la misma que usará la aplicación nativa de
 * Release 2 (CON-002).
 */

type ScreenState =
  | { readonly kind: "loading" }
  | { readonly kind: "notFound" }
  | { readonly kind: "failed"; readonly failure: NewsFailure }
  | { readonly kind: "loaded"; readonly post: NewsPostDetail };

function PostNotFound({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  return (
    <header className="news-post-header">
      <h1>{translate("news.post.notFound.title")}</h1>
      <p className="app-lead">{translate("news.post.notFound.lead")}</p>
    </header>
  );
}

function PostContent({
  translate,
  post,
}: {
  readonly translate: Translator;
  readonly post: NewsPostDetail;
}): React.JSX.Element {
  const formatMoment = (instant: string): string =>
    formatClubMoment(translate.locale, new Date(instant));
  return (
    <article className="news-post">
      <header className="news-post-header">
        <p className="news-row-meta">
          <NewsCategoryLabel translate={translate} category={post.category} />
          {post.status === "withdrawn" ? (
            <span className="news-withdrawn">
              {translate("news.post.withdrawn")}
            </span>
          ) : null}
        </p>
        <h1>{post.title}</h1>
        <p className="news-post-byline">
          <span>{post.author.fullName}</span>
          <span aria-hidden="true"> · </span>
          <time dateTime={post.publishedAt}>
            {translate("news.post.published", {
              date: formatMoment(post.publishedAt),
            })}
          </time>
        </p>
        {post.editedAt === null ? null : (
          <p className="news-post-edited">
            <time dateTime={post.editedAt}>
              {translate("news.post.edited", {
                date: formatMoment(post.editedAt),
              })}
            </time>
          </p>
        )}
      </header>
      <p className="news-post-body">{post.body}</p>
      {post.attachments.length > 0 ? (
        <NewsAttachmentList
          translate={translate}
          postId={post.id}
          attachments={post.attachments}
        />
      ) : null}
    </article>
  );
}

export function NewsPostScreen({
  locale,
  postId,
}: {
  readonly locale: Locale;
  readonly postId: string;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadNewsPost(postId).then((outcome) => {
      if (!isCurrent) {
        return;
      }
      if (outcome.kind === "loaded") {
        setState({ kind: "loaded", post: outcome.post });
      } else if (outcome.failure === "not_found") {
        setState({ kind: "notFound" });
      } else {
        setState({ kind: "failed", failure: outcome });
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [postId, reloads]);

  function retryLoad(): void {
    setState({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  return (
    <div className="news-post-screen">
      <Link href={NEWS_PATH} className="member-record-back">
        {translate("news.post.back")}
      </Link>
      {state.kind === "loading" ? (
        <p className="admin-empty">{translate("news.post.loading")}</p>
      ) : null}
      {state.kind === "failed" ? (
        <div className="admin-load-failure">
          <p className="auth-error" role="alert">
            {describeNewsFailure(
              translate,
              state.failure,
              "news.post.error.unexpected",
            )}
          </p>
          <button type="button" className="auth-submit" onClick={retryLoad}>
            {translate("news.retry")}
          </button>
        </div>
      ) : null}
      {state.kind === "notFound" ? (
        <PostNotFound translate={translate} />
      ) : null}
      {state.kind === "loaded" ? (
        <PostContent translate={translate} post={state.post} />
      ) : null}
    </div>
  );
}
