"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { loadGroups } from "@/components/groups/groups-client";
import { useIsPhone } from "@/components/use-is-phone";
import { NEWS_POST_PATH } from "@/lib/auth/routes";
import type { Group } from "@/lib/groups/groups";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import type { EditableNewsPost } from "@/lib/news/news-management";
import { type NewsFormPinning, NewsPublishForm } from "./NewsPublishForm";
import { loadNewsFormPinning } from "./load-news-form-pinning";
import { loadEditableNewsPost } from "./news-manage-client";
import { BackLink } from "@/components/BackLink";

/**
 * Editar una publicación (#331, RF-6 del PRD de E11), abierta desde la
 * publicación. Es el formulario de publicar con sus valores cargados.
 *
 * La frontera ya mandó al panel a quien no es Admin ni Committee. Que la
 * publicación sea suya lo decide el endpoint: a un Committee que abre la de
 * otra persona se le dice que no puede, sin formulario. Al guardar vuelve a
 * la publicación, que se lee de nuevo y ya dice que se editó.
 *
 * Al Admin le enseña además la caja de fijar (#599), encendida si la
 * publicación está fijada, y para eso lee también cuál es la fijada vigente.
 */

type ScreenState =
  | { readonly kind: "loading" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly post: EditableNewsPost;
      readonly groups: readonly Group[];
      readonly pinning: NewsFormPinning | null;
    };

async function loadEditScreen(
  postId: string,
  canPin: boolean,
): Promise<ScreenState> {
  const [post, groups, pinning] = await Promise.all([
    loadEditableNewsPost(postId),
    loadGroups(),
    loadNewsFormPinning(canPin),
  ]);
  if (post.kind === "failed") {
    return post.failure === "forbidden"
      ? { kind: "forbidden" }
      : { kind: "failed" };
  }
  if (groups.kind !== "loaded" || pinning.kind === "failed") {
    return { kind: "failed" };
  }
  return {
    kind: "ready",
    post: post.post,
    groups: groups.groups,
    pinning: pinning.pinning,
  };
}

export function NewsEditScreen({
  locale,
  postId,
  canPin,
}: {
  readonly locale: Locale;
  readonly postId: string;
  /** Si quien edita puede fijar (D1): sólo decide si ve la caja. */
  readonly canPin: boolean;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const router = useRouter();
  const isPhone = useIsPhone();
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);
  const postPath = NEWS_POST_PATH.replace("[id]", encodeURIComponent(postId));

  useEffect(() => {
    let isCurrent = true;
    void loadEditScreen(postId, canPin).then((loaded) => {
      if (isCurrent) {
        setState(loaded);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [postId, canPin, reloads]);

  function retryLoad(): void {
    setState({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  // En el móvil el formulario trae su barra, con Cancelar y el título (#602).
  const hasPhoneBar = isPhone && state.kind === "ready";
  return (
    <div className="member-record news-publish">
      {hasPhoneBar ? null : (
        <>
          <BackLink href={postPath}>{translate("news.edit.back")}</BackLink>
          <header className="member-record-header">
            <h1>{translate("news.edit.title")}</h1>
            <p className="app-lead">{translate("news.edit.lead")}</p>
          </header>
        </>
      )}
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
          pinning={state.pinning}
          onLeave={() => router.push(postPath)}
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
