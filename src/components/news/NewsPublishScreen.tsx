"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { loadGroups } from "@/components/groups/groups-client";
import { NEWS_PATH } from "@/lib/auth/routes";
import type { Group } from "@/lib/groups/groups";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import { NewsPublishForm } from "./NewsPublishForm";

/**
 * Publicar en Noticias (#330), abierto desde la cabecera del feed.
 *
 * La frontera ya mandó al panel a quien no es Admin ni Committee. Los grupos
 * que se ofrecen como audiencia se leen del endpoint de E4, así que son los
 * vigentes del club y no una lista escrita a mano. Al publicar vuelve al feed
 * sin recargar: el feed pide su primera página al montarse, y el servidor la
 * sirve de la más reciente a la más antigua, así que la nueva sale arriba.
 */

type GroupsState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly groups: readonly Group[] };

export function NewsPublishScreen({
  locale,
}: {
  readonly locale: Locale;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const router = useRouter();
  const [groups, setGroups] = useState<GroupsState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadGroups().then((loaded) => {
      if (isCurrent) {
        setGroups(
          loaded.kind === "loaded"
            ? { kind: "ready", groups: loaded.groups }
            : { kind: "failed" },
        );
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [reloads]);

  function retryLoad(): void {
    setGroups({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  return (
    <div className="member-record news-publish">
      <Link href={NEWS_PATH} className="member-record-back">
        {translate("news.publish.back")}
      </Link>
      <header className="member-record-header">
        <h1>{translate("news.publish.title")}</h1>
        <p className="app-lead">{translate("news.publish.lead")}</p>
      </header>
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
          intent={{
            kind: "publish",
            onPublished: () => router.push(NEWS_PATH),
          }}
        />
      ) : null}
    </div>
  );
}
