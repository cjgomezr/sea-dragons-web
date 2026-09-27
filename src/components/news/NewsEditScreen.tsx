"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { loadGroups } from "@/components/groups/groups-client";
import { NEWS_POST_PATH } from "@/lib/auth/routes";
import type { Group } from "@/lib/groups/groups";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import type { EditableNewsPost } from "@/lib/news/news-management";
import { NewsPublishForm } from "./NewsPublishForm";
import { loadEditableNewsPost } from "./news-manage-client";

/**
 * Editar una publicación (#331, RF-6 del PRD de E11), abierta desde la
 * publicación. Es el formulario de publicar con sus valores cargados.
 *
 * La frontera ya mandó al panel a quien no es Admin ni Committee. Que la
 * publicación sea suya lo decide el endpoint: a un Committee que abre la de
 * otra persona se le dice que no puede, sin formulario. Al guardar vuelve a
 * la publicación, que se lee de nuevo y ya dice que se editó.
 */

type ScreenState =
  | { readonly kind: "loading" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly post: EditableNewsPost;
      readonly groups: readonly Group[];
    };

async function loadEditScreen(postId: string): Promise<ScreenState> {
  const [post, groups] = await Promise.all([
    loadEditableNewsPost(postId),
    loadGroups(),
  ]);
  if (post.kind === "failed") {
    return post.failure === "forbidden"
      ? { kind: "forbidden" }
      : { kind: "failed" };
  }
  if (groups.kind !== "loaded") {
    return { kind: "failed" };
  }
  return { kind: "ready", post: post.post, groups: groups.groups };
}

export function NewsEditScreen({
  locale,
  postId,
}: {
  readonly locale: Locale;
  readonly postId: string;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const router = useRouter();
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);
  const postPath = NEWS_POST_PATH.replace("[id]", encodeURIComponent(postId));

  useEffect(() => {
    let isCurrent = true;
    void loadEditScreen(postId).then((loaded) => {
      if (isCurrent) {
        setState(loaded);
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
    <div className="member-record news-publish">
      <Link href={postPath} className="member-record-back">
        {translate("news.edit.back")}
      </Link>
      <header className="member-record-header">
        <h1>{translate("news.edit.title")}</h1>
        <p className="app-lead">{translate("news.edit.lead")}</p>
      </header>
      {state.kind === "loading" ? (
        <p className="admin-empty">{translate("news.edit.loading")}</p>
      ) : null}
      {state.kind === "forbidden" ? (
        <p className="auth-error" role="alert">
          {translate("news.edit.forbidden")}
        </p>
      ) : null}
      {state.kind === "failed" ? (
        <div className="admin-load-failure">
          <p className="auth-error" role="alert">
            {translate("news.edit.loadFailed")}
          </p>
          <button type="button" className="auth-submit" onClick={retryLoad}>
            {translate("news.retry")}
          </button>
        </div>
      ) : null}
      {state.kind === "ready" ? (
        <NewsPublishForm
          translate={translate}
          clubGroups={state.groups}
          intent={{
            kind: "edit",
            post: state.post,
            onSaved: () => router.push(postPath),
          }}
        />
      ) : null}
    </div>
  );
}
