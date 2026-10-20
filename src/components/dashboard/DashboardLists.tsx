import Link from "next/link";
import { useId } from "react";
import { DateBlock } from "@/components/calendar/AgendaRow";
import { EventTypeTag } from "@/components/calendar/EventTypeTag";
import { CALENDAR_PATH } from "@/lib/auth/routes";
import type { UpcomingEvents } from "@/lib/dashboard/dashboard";
import type { AgendaEvent } from "@/lib/events/event-agenda";
import { formatClockTime } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";

/**
 * "Próximos" del inicio (#426, RF-2 del PRD de E14): hasta tres, con el
 * enlace al calendario, adonde lleva también cada evento, como los avisos de
 * eventos. Las noticias del inicio están en `DashboardNews` (#751).
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
        <EventTypeTag translate={translate} eventType={event.eventType} />
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
