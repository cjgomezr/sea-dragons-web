"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { loadGroups } from "@/components/groups/groups-client";
import { useIsPhone } from "@/components/use-is-phone";
import { NEWS_PATH } from "@/lib/auth/routes";
import type { Group } from "@/lib/groups/groups";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import { type NewsFormPinning, NewsPublishForm } from "./NewsPublishForm";
import { loadNewsFormPinning } from "./load-news-form-pinning";
import { BackLink } from "@/components/BackLink";

/**
 * Publicar en Noticias (#330), abierto desde la cabecera del feed.
 *
 * La frontera ya mandó al panel a quien no es Admin ni Committee. Los grupos
 * que se ofrecen como audiencia se leen del endpoint de E4, así que son los
 * vigentes del club y no una lista escrita a mano. Al publicar vuelve al feed
 * sin recargar: el feed pide su primera página al montarse, y el servidor la
 * sirve de la más reciente a la más antigua, así que la nueva sale arriba.
 *
 * Al Admin le enseña además la caja de fijar (#599), que necesita saber cuál
 * es la fijada vigente: se lee con los grupos, antes de pintar el formulario.
 */

type GroupsState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly groups: readonly Group[];
      readonly pinning: NewsFormPinning | null;
    };

async function loadPublishScreen(canPin: boolean): Promise<GroupsState> {
  const [groups, pinning] = await Promise.all([
    loadGroups(),
    loadNewsFormPinning(canPin),
  ]);
  if (groups.kind !== "loaded" || pinning.kind === "failed") {
    return { kind: "failed" };
  }
  return { kind: "ready", groups: groups.groups, pinning: pinning.pinning };
}

export function NewsPublishScreen({
  locale,
  canPin,
}: {
  readonly locale: Locale;
  /** Si quien publica puede fijar (D1): sólo decide si ve la caja. */
  readonly canPin: boolean;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const router = useRouter();
  const isPhone = useIsPhone();
  const [groups, setGroups] = useState<GroupsState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadPublishScreen(canPin).then((loaded) => {
      if (isCurrent) {
        setGroups(loaded);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [canPin, reloads]);

  function retryLoad(): void {
    setGroups({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  // En el móvil el formulario trae su barra, con Cancelar y el título (#602).
  const hasPhoneBar = isPhone && groups.kind === "ready";
  return (
    <div className="member-record news-publish">
      {hasPhoneBar ? null : (
        <>
          <BackLink href={NEWS_PATH}>{translate("news.publish.back")}</BackLink>
          <header className="member-record-header">
            <h1>{translate("news.publish.title")}</h1>
            <p className="app-lead">{translate("news.publish.lead")}</p>
          </header>
        </>
      )}
      {groups.kind === "loading" ? (
        <p className="admin-empty">{translate("news.publish.loading")}</p>
      ) : null}
      {groups.kind === "failed" ? (
        <div className="admin-load-failure">
          <p className="auth-error" role="alert">
            {translate("news.publish.loadFailed")}
          </p>
          <button type="button" className="auth-submit" onClick={retryLoad}>
            {translate("news.retry")}
          </button>
        </div>
      ) : null}
      {groups.kind === "ready" ? (
        <NewsPublishForm
          translate={translate}
          clubGroups={groups.groups}
          pinning={groups.pinning}
          onLeave={() => router.push(NEWS_PATH)}
          intent={{
            kind: "publish",
            onPublished: () => router.push(NEWS_PATH),
          }}
        />
      ) : null}
    </div>
  );
}
