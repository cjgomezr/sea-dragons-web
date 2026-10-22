"use client";

import { CalendarBlank } from "@phosphor-icons/react/dist/ssr/CalendarBlank";
import { Newspaper } from "@phosphor-icons/react/dist/ssr/Newspaper";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react/dist/lib/types";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Icon } from "@/components/Icon";
import {
  CALENDAR_PATH,
  CALENDAR_EVENT_QUERY_PARAM,
  NEWS_POST_PATH,
} from "@/lib/auth/routes";
import type {
  AudienceEvent,
  AudiencePost,
  AudienceSlice,
  GroupAudience,
} from "@/lib/groups/group-audience";
import type { Translator } from "@/lib/i18n/translator";
import {
  describeAudienceEventDate,
  describeAudiencePostDate,
} from "./group-texts";
import {
  type GroupAudienceLoad,
  isGroupGone,
  loadGroupAudience,
} from "./groups-client";

/**
 * La columna "Audiencia de" del panel (#830, RF-5 de E32): los eventos y las
 * noticias que tienen al grupo de audiencia, cada uno enlazado a su página.
 * El servidor ya manda sólo lo vigente y como mucho cinco de cada uno, con su
 * total; aquí sólo se pinta, y se dice cuántos más quedan.
 */

type AudienceState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  /** Como en la lista de miembros: se guarda y el efecto avisa al padre. */
  | { readonly kind: "gone" }
  | { readonly kind: "ready"; readonly audience: GroupAudience };

type AudienceRow = {
  readonly id: string;
  readonly href: string;
  readonly title: string;
  readonly date: string;
};

function readAudience(outcome: GroupAudienceLoad): AudienceState {
  if (outcome.kind === "loaded") {
    return { kind: "ready", audience: outcome.audience };
  }
  return isGroupGone(outcome) ? { kind: "gone" } : { kind: "failed" };
}

/** Una serie enlaza a su próxima sesión: la serie en sí no tiene fila en el
 * calendario. Lo que llega aquí es de hoy en adelante, así que va a los
 * próximos. */
function eventHref(event: AudienceEvent): string {
  const sessionId = event.kind === "event" ? event.id : event.nextSession.id;
  return `${CALENDAR_PATH}?${CALENDAR_EVENT_QUERY_PARAM}=${sessionId}`;
}

function isEmpty(audience: GroupAudience): boolean {
  return audience.events.total === 0 && audience.posts.total === 0;
}

function AudienceList({
  translate,
  label,
  glyph,
  tone,
  rows,
  total,
}: {
  translate: Translator;
  label: string;
  glyph: PhosphorIcon;
  tone: "event" | "post";
  rows: readonly AudienceRow[];
  total: number;
}): React.JSX.Element | null {
  if (rows.length === 0) {
    return null;
  }
  const hiddenCount = total - rows.length;
  return (
    <>
      <ul className="groups-audience-list" aria-label={label}>
        {rows.map((row) => (
          <li key={row.id}>
            <Link className="groups-audience-row" href={row.href}>
              <span
                className={`groups-audience-tile groups-audience-tile-${tone}`}
              >
                <Icon glyph={glyph} />
              </span>
              <span className="groups-audience-text">
                <span className="groups-audience-title">{row.title}</span>
                <span className="groups-audience-date">{row.date}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <p className="groups-audience-more">
          {translate("groups.audience.more", { count: hiddenCount })}
        </p>
      ) : null}
    </>
  );
}

function eventRows(
  translate: Translator,
  events: AudienceSlice<AudienceEvent>,
): readonly AudienceRow[] {
  return events.items.map((event) => ({
    id: event.id,
    href: eventHref(event),
    title: event.title,
    date: describeAudienceEventDate(translate, event),
  }));
}

function postRows(
  translate: Translator,
  posts: AudienceSlice<AudiencePost>,
): readonly AudienceRow[] {
  return posts.items.map((post) => ({
    id: post.id,
    href: NEWS_POST_PATH.replace("[id]", post.id),
    title: post.title,
    date: describeAudiencePostDate(translate, post),
  }));
}

function AudienceContent({
  translate,
  audience,
}: {
  translate: Translator;
  audience: GroupAudience;
}): React.JSX.Element {
  if (isEmpty(audience)) {
    return (
      <p className="groups-audience-empty">
        {translate("groups.audience.empty")}
      </p>
    );
  }
  return (
    <>
      <AudienceList
        translate={translate}
        label={translate("groups.audience.events")}
        glyph={CalendarBlank}
        tone="event"
        rows={eventRows(translate, audience.events)}
        total={audience.events.total}
      />
      <AudienceList
        translate={translate}
        label={translate("groups.audience.posts")}
        glyph={Newspaper}
        tone="post"
        rows={postRows(translate, audience.posts)}
        total={audience.posts.total}
      />
    </>
  );
}

export function GroupAudienceColumn({
  translate,
  groupId,
  onGroupGone,
}: {
  translate: Translator;
  groupId: string;
  /** El servidor dice que el grupo ya no está, como en sus miembros. */
  onGroupGone: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const [state, setState] = useState<AudienceState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    void loadGroupAudience(groupId).then((outcome) =>
      setState(readAudience(outcome)),
    );
  }, [groupId, reloads]);

  useEffect(() => {
    if (state.kind === "gone") {
      onGroupGone();
    }
  }, [state.kind, onGroupGone]);

  function retryLoad(): void {
    setState({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  return (
    <section className="groups-audience" aria-labelledby={titleId}>
      <h3 id={titleId} className="groups-audience-heading">
        {translate("groups.audience.title")}
      </h3>
      {state.kind === "loading" ? (
        <p className="groups-audience-empty">
          {translate("groups.audience.loading")}
        </p>
      ) : null}
      {state.kind === "failed" ? (
        <div className="admin-load-failure">
          <p className="auth-error" role="alert">
            {translate("groups.audience.loadFailed")}
          </p>
          <button type="button" className="auth-submit" onClick={retryLoad}>
            {translate("groups.retry")}
          </button>
        </div>
      ) : null}
      {state.kind === "ready" ? (
        <AudienceContent translate={translate} audience={state.audience} />
      ) : null}
    </section>
  );
}
