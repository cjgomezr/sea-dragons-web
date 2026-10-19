import { Clock } from "@phosphor-icons/react/dist/ssr/Clock";
import { LockSimple } from "@phosphor-icons/react/dist/ssr/LockSimple";
import { MapPin } from "@phosphor-icons/react/dist/ssr/MapPin";
import { NavigationArrow } from "@phosphor-icons/react/dist/ssr/NavigationArrow";
import Link from "next/link";
import { useId } from "react";
import { describeRsvpFailure } from "@/components/calendar/agenda-client";
import { describeAudience } from "@/components/calendar/EventDetailPanel";
import { EventCover } from "@/components/calendar/EventCover";
import { EventRsvp } from "@/components/calendar/EventRsvp";
import { EventTypeTag } from "@/components/calendar/EventTypeTag";
import { describeEventWhen } from "@/components/calendar/event-panel-text";
import { useEventRsvp } from "@/components/calendar/use-event-rsvp";
import { PAYMENTS_PATH } from "@/lib/auth/routes";
import type { DashboardNextUpEvent, NextUp } from "@/lib/dashboard/dashboard";
import { nextUpDistance } from "@/lib/dashboard/dashboard-view";
import type { EventTally } from "@/components/calendar/agenda-client";
import { buildMapsUrl } from "@/lib/events/event-place";
import { formatDashboardDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { NewEventLink } from "./NewEventLink";
import { MyTeamStrip, UnpublishedTeamsRow } from "./NextUpTeamRows";

/**
 * La tarjeta "Próximo" del inicio (#747, RF-3 del PRD de E27): el siguiente
 * evento que ve quien mira (D4), con su imagen o el fondo de su tipo, cuándo,
 * dónde y "Cómo llegar", y debajo Voy, Quizás y No puedo. Guarda por el mismo
 * camino que el calendario: la misma petición, el mismo corte del segundo
 * toque y el mismo aviso si falla.
 *
 * A quien no tiene la membresía al día le cambia los botones por la fila con
 * candado que lleva a Pagos. A quien juega en el reparto publicado le dice en
 * qué equipo (D6); a Admin y Coach, si el reparto sigue sin publicar.
 */

type NextUpEvent = Extract<NextUp, { readonly kind: "event" }>;

/** Lo que el inicio sabe de quien mira y la tarjeta necesita. */
export type NextUpViewer = {
  readonly isRestricted: boolean;
  readonly canCreateEvents: boolean;
  /** El día del club (YYYY-MM-DD) en que se pintó el inicio. */
  readonly today: string;
};

// El detalle que llega tras guardar sirve al panel del calendario; aquí no
// hay nada abierto que poner al día.
function ignoreOpenedDetail(): void {}

function describePill(
  translate: Translator,
  event: NextUpEvent,
  today: string,
): string {
  const distance = nextUpDistance(event.startsOn, today);
  switch (distance.kind) {
    case "today":
      return translate("dashboard.nextUp.today");
    case "tomorrow":
      return translate("dashboard.nextUp.tomorrow");
    case "days":
      return translate("dashboard.nextUp.inDays", { count: distance.days });
  }
}

/** "Fri 2 Oct · 9:00 am – 11:00 am · 2 h"; uno de varios días, con los dos
 * extremos como en el panel del calendario. */
function describeWhen(translate: Translator, event: NextUpEvent): string {
  const when = describeEventWhen(translate, event);
  const day =
    event.endsOn === null
      ? formatDashboardDay(translate.locale, event.startsOn)
      : when.day;
  return translate("dashboard.nextUp.when", { day, hours: when.hours });
}

/** Sólo un lugar elegido del buscador, con dirección o coordenadas, tiene
 * a dónde llevar. */
function hasDirections(event: NextUpEvent): boolean {
  const { place } = event;
  return place !== null && (place.lat !== null || place.address !== null);
}

function describeCounts(translate: Translator, tally: EventTally): string {
  return translate("calendar.event.counts", {
    going: translate("calendar.event.going", { count: tally.goingCount }),
    maybe: translate("calendar.event.maybe", { count: tally.maybeCount }),
  });
}

function WhenAndWhere({
  translate,
  event,
}: {
  readonly translate: Translator;
  readonly event: NextUpEvent;
}): React.JSX.Element {
  return (
    <>
      <p className="dashboard-next-up-line">
        <Clock aria-hidden="true" focusable="false" size={18} />
        <span>{describeWhen(translate, event)}</span>
      </p>
      <div className="dashboard-next-up-line dashboard-next-up-place">
        <MapPin aria-hidden="true" focusable="false" size={18} />
        <span>{event.location}</span>
        {hasDirections(event) ? (
          <a
            className="dashboard-next-up-directions"
            href={buildMapsUrl(event)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <NavigationArrow aria-hidden="true" focusable="false" size={16} />
            {translate("calendar.panel.directions")}{" "}
            <span className="visually-hidden">
              {translate("calendar.event.opensMap")}
            </span>
          </a>
        ) : null}
      </div>
    </>
  );
}

function NextUpRsvp({
  translate,
  event,
}: {
  readonly translate: Translator;
  readonly event: DashboardNextUpEvent;
}): React.JSX.Element {
  const { state, respond } = useEventRsvp(event, ignoreOpenedDetail);
  return (
    <div className="dashboard-next-up-rsvp">
      <EventRsvp
        translate={translate}
        title={event.title}
        savedResponse={state.tally.myResponse}
        pendingResponse={state.pendingResponse}
        onRespond={respond}
        variant="panel"
      />
      {state.failure === null ? null : (
        <p className="auth-error agenda-rsvp-error" role="alert">
          {describeRsvpFailure(translate, state.failure)}
        </p>
      )}
      <p className="dashboard-next-up-counts">
        {describeCounts(translate, state.tally)}
      </p>
      <p className="agenda-rsvp-status" role="status">
        {state.pendingResponse === null
          ? null
          : translate("calendar.rsvp.saving")}
      </p>
    </div>
  );
}

function LockedRsvp({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  return (
    <div className="dashboard-next-up-locked">
      <LockSimple aria-hidden="true" focusable="false" size={18} />
      <p>{translate("dashboard.nextUp.locked")}</p>
      <Link href={PAYMENTS_PATH} className="dashboard-next-up-row-link">
        {translate("dashboard.nextUp.renew")}
      </Link>
    </div>
  );
}

/** La franja del equipo de quien juega, o el aviso del reparto sin publicar
 * para quien lo arma. */
function TeamRow({
  translate,
  event,
}: {
  readonly translate: Translator;
  readonly event: NextUpEvent;
}): React.JSX.Element | null {
  if (event.myTeam !== null) {
    return (
      <MyTeamStrip
        translate={translate}
        eventId={event.id}
        team={event.myTeam}
      />
    );
  }
  const isUnpublished = "teamsStatus" in event && event.teamsStatus === "draft";
  return isUnpublished ? (
    <UnpublishedTeamsRow translate={translate} eventId={event.id} />
  ) : null;
}

function EventCard({
  translate,
  event,
  viewer,
}: {
  readonly translate: Translator;
  readonly event: NextUpEvent;
  readonly viewer: NextUpViewer;
}): React.JSX.Element {
  return (
    <>
      <div className="dashboard-next-up-cover">
        <EventCover
          url={event.coverUrl}
          eventType={event.eventType}
          iconSize={84}
        />
        <p className="dashboard-next-up-pill">
          {describePill(translate, event, viewer.today)}
        </p>
      </div>
      <div className="dashboard-next-up-body">
        <div className="agenda-panel-tags">
          <EventTypeTag translate={translate} eventType={event.eventType} />
          <span className="agenda-panel-audience">
            {describeAudience(translate, event.audience)}
          </span>
        </div>
        <h2 className="dashboard-next-up-title">{event.title}</h2>
        <WhenAndWhere translate={translate} event={event} />
        {viewer.isRestricted ? (
          <LockedRsvp translate={translate} />
        ) : (
          <NextUpRsvp key={event.id} translate={translate} event={event} />
        )}
        <TeamRow translate={translate} event={event} />
      </div>
    </>
  );
}

function NextUpFallback({
  translate,
  nextUp,
  viewer,
  onRetry,
}: {
  readonly translate: Translator;
  readonly nextUp: Exclude<NextUp, NextUpEvent>;
  readonly viewer: NextUpViewer;
  readonly onRetry: () => void;
}): React.JSX.Element {
  if (nextUp.kind === "none") {
    return (
      <div className="dashboard-next-up-empty">
        <p>{translate("dashboard.nextUp.none")}</p>
        {viewer.canCreateEvents ? <NewEventLink translate={translate} /> : null}
      </div>
    );
  }
  return (
    <div className="dashboard-next-up-empty">
      <p>{translate("dashboard.nextUp.unavailable")}</p>
      <button type="button" className="admin-secondary" onClick={onRetry}>
        {translate("dashboard.retry")}
      </button>
    </div>
  );
}

export function NextUpCard({
  translate,
  nextUp,
  viewer,
  onRetry,
}: {
  readonly translate: Translator;
  readonly nextUp: NextUp;
  readonly viewer: NextUpViewer;
  /** Vuelve a pedir el inicio cuando la tarjeta no se pudo leer. */
  readonly onRetry: () => void;
}): React.JSX.Element {
  const labelId = useId();
  const typeClass =
    nextUp.kind === "event" ? ` dashboard-next-up-${nextUp.eventType}` : "";
  return (
    <section
      className={`dashboard-next-up${typeClass}`}
      aria-labelledby={labelId}
    >
      <h2 id={labelId} className="visually-hidden">
        {translate("dashboard.nextUp.label")}
      </h2>
      {nextUp.kind === "event" ? (
        <EventCard translate={translate} event={nextUp} viewer={viewer} />
      ) : (
        <NextUpFallback
          translate={translate}
          nextUp={nextUp}
          viewer={viewer}
          onRetry={onRetry}
        />
      )}
    </section>
  );
}
