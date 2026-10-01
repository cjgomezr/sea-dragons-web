import Link from "next/link";
import { useId } from "react";
import { DateBlock } from "@/components/calendar/AgendaRow";
import { NewsCategoryLabel } from "@/components/news/NewsCategoryLabel";
import { CALENDAR_PATH, NEWS_PATH, NEWS_POST_PATH } from "@/lib/auth/routes";
import type {
  LatestNews,
  LatestNewsItem,
  UpcomingEvents,
} from "@/lib/dashboard/dashboard";
import type { AgendaEvent } from "@/lib/events/event-agenda";
import { formatClockTime, formatRelativeTime } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";

/**
 * "Próximos" y "Últimas noticias" del inicio (#426, RF-2 del PRD de E14):
 * hasta tres de cada, con el enlace a la sección completa. Un evento lleva al
 * calendario, como los avisos de eventos; una noticia, a su publicación.
 */

function DashboardPanel({
  title,
  allLabel,
  allHref,
  children,
}: {
  readonly title: string;
  readonly allLabel: string;
  readonly allHref: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const titleId = useId();
  return (
    <section className="dashboard-panel" aria-labelledby={titleId}>
      <header className="dashboard-panel-header">
        <h2 id={titleId}>{title}</h2>
        <Link href={allHref} className="dashboard-panel-all">
          {allLabel}
          <span aria-hidden="true"> →</span>
        </Link>
      </header>
      {children}
    </section>
  );
}

function UpcomingRow({
  translate,
  event,
}: {
  readonly translate: Translator;
  readonly event: AgendaEvent;
}): React.JSX.Element {
  return (
    <li>
      <Link href={CALENDAR_PATH} className="dashboard-event">
        <DateBlock translate={translate} startsOn={event.startsOn} />
        <span className="dashboard-event-body">
          <span className="dashboard-event-title">{event.title}</span>
          <span className="dashboard-event-when">
            {translate("calendar.event.timeAndPlace", {
              time: formatClockTime(translate.locale, event.startTime),
              location: event.location,
            })}
          </span>
        </span>
        <span className={`agenda-type agenda-type-${event.eventType}`}>
          {translate(`event.type.${event.eventType}`)}
        </span>
      </Link>
    </li>
  );
}

export function UpcomingPanel({
  translate,
  upcoming,
}: {
  readonly translate: Translator;
  readonly upcoming: UpcomingEvents;
}): React.JSX.Element {
  return (
    <DashboardPanel
      title={translate("dashboard.upcoming.title")}
      allLabel={translate("dashboard.upcoming.all")}
      allHref={CALENDAR_PATH}
    >
      {upcoming.kind === "unavailable" ? (
        <p className="admin-empty">{translate("dashboard.unavailable")}</p>
      ) : null}
      {upcoming.kind === "events" && upcoming.events.length === 0 ? (
        <p className="admin-empty">{translate("dashboard.upcoming.empty")}</p>
      ) : null}
      {upcoming.kind === "events" && upcoming.events.length > 0 ? (
        <ul className="dashboard-event-list">
          {upcoming.events.map((event) => (
            <UpcomingRow key={event.id} translate={translate} event={event} />
          ))}
        </ul>
      ) : null}
    </DashboardPanel>
  );
}

function NewsRow({
  translate,
  post,
  now,
}: {
  readonly translate: Translator;
  readonly post: LatestNewsItem;
  readonly now: Date;
}): React.JSX.Element {
  return (
    <li className="dashboard-news">
      <NewsCategoryLabel translate={translate} category={post.category} />
      <Link
        href={NEWS_POST_PATH.replace("[id]", encodeURIComponent(post.id))}
        className="dashboard-news-link"
      >
        {post.title}
      </Link>
      <time className="dashboard-news-when" dateTime={post.publishedAt}>
        {formatRelativeTime(translate.locale, new Date(post.publishedAt), now)}
      </time>
    </li>
  );
}

export function LatestNewsPanel({
  translate,
  news,
  now,
}: {
  readonly translate: Translator;
  readonly news: LatestNews;
  /** El instante con el que se calcula "hace N". */
  readonly now: Date;
}): React.JSX.Element {
  return (
    <DashboardPanel
      title={translate("dashboard.news.title")}
      allLabel={translate("dashboard.news.all")}
      allHref={NEWS_PATH}
    >
      {news.kind === "unavailable" ? (
        <p className="admin-empty">{translate("dashboard.unavailable")}</p>
      ) : null}
      {news.kind === "news" && news.posts.length === 0 ? (
        <p className="admin-empty">{translate("dashboard.news.empty")}</p>
      ) : null}
      {news.kind === "news" && news.posts.length > 0 ? (
        <ul className="dashboard-news-list">
          {news.posts.map((post) => (
            <NewsRow
              key={post.id}
              translate={translate}
              post={post}
              now={now}
            />
          ))}
        </ul>
      ) : null}
    </DashboardPanel>
  );
}
