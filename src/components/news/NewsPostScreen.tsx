"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { NEWS_PATH } from "@/lib/auth/routes";
import { formatClubMoment } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import type {
  NewsPostAudienceLabel,
  NewsPostDetail,
} from "@/lib/news/news-posts";
import { MemberAvatar } from "@/components/MemberAvatar";
import {
  type NewsFailure,
  describeNewsFailure,
  loadNewsPost,
  recordNewsVisit,
} from "./news-client";
import { NewsAttachmentList } from "./NewsAttachmentList";
import { NewsCategoryLabel } from "./NewsCategoryLabel";
import { NewsCover } from "./NewsCover";
import { NewsMarkdown } from "./NewsMarkdown";
import { NewsPostActions } from "./NewsPostActions";

/**
 * Una publicación abierta (#329, RF-5 del PRD de E11), con el diseño 1c de
 * E22 (#596): la portada arriba, o el fondo de su categoría, y debajo una
 * columna de lectura con la categoría y la audiencia, el título, el autor con
 * su foto y sus fechas, el cuerpo en Markdown (#593) y los adjuntos.
 *
 * Lo que no le corresponde a quien mira llega del servidor como 404, igual
 * que lo que no existe, y aquí se pinta la misma pantalla para los dos:
 * ninguna pista de que exista. Es de cliente porque lee por la API v1, la
 * misma que usará la aplicación nativa de Release 2 (CON-002).
 *
 * A quien puede editarla y retirarla (#331) le ofrece esas acciones en la
 * línea del autor; lo que responde el servidor sustituye a lo que había.
 */

/** Las medidas del handoff: el icono del fondo grande y el avatar. */
const COVER_ICON_SIZE = 88;
const AVATAR_SIZE = 40;
const AUDIENCE_SEPARATOR = " · ";

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

function describeAudience(
  translate: Translator,
  audience: NewsPostAudienceLabel,
): string {
  if (audience.kind === "club") {
    return translate("news.post.audience.club");
  }
  return translate("news.post.audience.groups", {
    groups: audience.groupNames.join(AUDIENCE_SEPARATOR),
  });
}

/** El nombre del autor y, debajo, "Publicada … · Editada …". */
function PostAuthorAndDates({
  translate,
  post,
}: {
  readonly translate: Translator;
  readonly post: NewsPostDetail;
}): React.JSX.Element {
  const formatMoment = (instant: string): string =>
    formatClubMoment(translate.locale, new Date(instant));
  return (
    <p className="news-post-byline-text">
      <span className="news-post-author">{post.author.fullName}</span>
      <span className="news-post-dates">
        <time dateTime={post.publishedAt}>
          {translate("news.post.published", {
            date: formatMoment(post.publishedAt),
          })}
        </time>
        {post.editedAt === null ? null : (
          <>
            <span aria-hidden="true"> · </span>
            <time dateTime={post.editedAt}>
              {translate("news.post.edited", {
                date: formatMoment(post.editedAt),
              })}
            </time>
          </>
        )}
      </span>
    </p>
  );
}

function PostContent({
  translate,
  post,
  onChanged,
}: {
  readonly translate: Translator;
  readonly post: NewsPostDetail;
  readonly onChanged: (post: NewsPostDetail) => void;
}): React.JSX.Element {
  return (
    <article className="news-post">
      <div className="news-post-cover">
        <NewsCover
          url={post.coverUrl}
          category={post.category}
          iconSize={COVER_ICON_SIZE}
        />
      </div>
      <div className="news-post-column">
        <header className="news-post-header">
          <p className="news-post-meta">
            <NewsCategoryLabel translate={translate} category={post.category} />
            <span>{describeAudience(translate, post.audience)}</span>
            {post.status === "withdrawn" ? (
              <span className="news-withdrawn">
                {translate("news.post.withdrawn")}
              </span>
            ) : null}
          </p>
          <h1>{post.title}</h1>
          <div className="news-post-byline">
            <MemberAvatar
              fullName={post.author.fullName}
              photoUrl={post.author.photoUrl}
              size={AVATAR_SIZE}
              className="news-post-avatar"
            />
            <PostAuthorAndDates translate={translate} post={post} />
            {post.canManage ? (
              <NewsPostActions
                translate={translate}
                post={post}
                onChanged={onChanged}
              />
            ) : null}
          </div>
        </header>
        <NewsMarkdown body={post.body} />
        {post.attachments.length > 0 ? (
          <NewsAttachmentList
            translate={translate}
            postId={post.id}
            attachments={post.attachments}
          />
        ) : null}
      </div>
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

  // Abrir una publicación también cuenta como visita a Noticias (#424).
  useEffect(() => {
    void recordNewsVisit();
  }, [postId]);

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
        <PostContent
          translate={translate}
          post={state.post}
          onChanged={(post) => setState({ kind: "loaded", post })}
        />
      ) : null}
    </div>
  );
}
