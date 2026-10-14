"use client";

import { ArrowLeft } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { NEWS_PATH } from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import type { NewsPostDetail } from "@/lib/news/news-posts";
import { NewsPostMoreActions } from "./NewsPostMoreActions";

/**
 * La barra propia de la publicación en el móvil (#601, "#2d" del handoff de
 * E22): volver, el nombre de la categoría en el centro y ⋯. Va debajo de la
 * cabecera de la app, que se queda (D10), y se pega arriba al hacer scroll.
 * Quien no puede editar, retirar ni fijar no tiene ⋯.
 */
export function NewsPostBar({
  translate,
  post,
  onChanged,
}: {
  readonly translate: Translator;
  readonly post: NewsPostDetail;
  readonly onChanged: (post: NewsPostDetail, announcement: string) => void;
}): React.JSX.Element {
  const backLabel = translate("news.post.bar.back");
  const hasActions = post.canManage || post.canPin;
  return (
    <nav className="news-post-bar" aria-label={translate("news.post.bar")}>
      <Link
        href={NEWS_PATH}
        className="news-post-bar-button"
        aria-label={backLabel}
        title={backLabel}
      >
        <Icon glyph={ArrowLeft} />
      </Link>
      <span className="news-post-bar-title">
        {translate(`news.category.${post.category}`)}
      </span>
      {hasActions ? (
        <NewsPostMoreActions
          translate={translate}
          post={post}
          onChanged={onChanged}
        />
      ) : null}
    </nav>
  );
}
