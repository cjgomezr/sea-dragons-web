import { ArrowLeft } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { useEffect, useId, useRef } from "react";
import { Icon } from "@/components/Icon";
import type { AgendaEvent } from "@/lib/events/event-agenda";
import type { Translator } from "@/lib/i18n/translator";
import type { EventTally } from "./agenda-client";
import {
  OpenedSections,
  WhenBlocks,
  describeAudience,
  openedOf,
} from "./EventDetailPanel";
import { EventCover } from "./EventCover";
import { EventPlaceCard } from "./EventPlaceCard";
import { EventTypeTag } from "./EventTypeTag";
import type { EventDetailState } from "./use-event-detail";

/**
 * La pantalla de un evento en el móvil (#656, RF-13 del PRD de E24, "#2b"
 * del handoff): por debajo de 768 px un evento no se abre en el panel de al
 * lado, sino aquí, en lugar de la agenda. Arriba, la barra con volver, la
 * etiqueta del tipo y el ⋯ de quien puede editar; debajo, la imagen de 200 px
 * con su barra y, en orden, el título y la audiencia, la hora, la repetición,
 * el lugar, "¿Vas?", los que van, las notas, los equipos y Pasar lista.
 *
 * Comparte con el panel de escritorio sus bloques: lo que cambia es la forma.
 * Como en el panel, el RSVP, los equipos y las acciones los pone la fila, que
 * es dueña de su estado. Al abrirse, el foco va al título.
 */

/** Lo que la fila pone en su sitio de la pantalla. */
export type ScreenSlots = {
  readonly more: React.ReactNode;
  readonly rsvp: React.ReactNode;
  readonly teams: React.ReactNode;
  readonly takeAttendance: React.ReactNode;
};

function ScreenBar({
  translate,
  event,
  more,
  onBack,
}: {
  readonly translate: Translator;
  readonly event: AgendaEvent;
  readonly more: React.ReactNode;
  readonly onBack: () => void;
}): React.JSX.Element {
  const backLabel = translate("calendar.screen.back");
  return (
    <div className="agenda-screen-bar">
      <button
        type="button"
        className="agenda-screen-bar-button"
        aria-label={backLabel}
        title={backLabel}
        onClick={onBack}
      >
        <Icon glyph={ArrowLeft} />
      </button>
      <span className="agenda-screen-bar-tag">
        <EventTypeTag translate={translate} eventType={event.eventType} />
      </span>
      {more}
    </div>
  );
}

export function EventScreen({
  translate,
  event,
  detail,
  tally,
  onRetry,
  slots,
  onBack,
}: {
  readonly translate: Translator;
  readonly event: AgendaEvent;
  readonly detail: EventDetailState;
  /** Los conteos de la fila, que ya cuentan la respuesta propia. */
  readonly tally: EventTally;
  readonly onRetry: () => void;
  readonly slots: ScreenSlots;
  readonly onBack: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const opened = openedOf(detail);
  const audience = opened === null ? null : opened.audience;

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <article
      className={`agenda-screen agenda-panel-${event.eventType}`}
      aria-labelledby={titleId}
    >
      <ScreenBar
        translate={translate}
        event={event}
        more={slots.more}
        onBack={onBack}
      />
      <div className="agenda-panel-cover agenda-screen-cover">
        <EventCover
          url={opened === null ? event.coverThumbUrl : opened.coverUrl}
          eventType={event.eventType}
          iconSize={76}
        />
      </div>
      <div className="agenda-screen-body">
        <div className="agenda-screen-heading">
          <h1
            ref={titleRef}
            id={titleId}
            className="agenda-screen-title"
            tabIndex={-1}
          >
            {event.title}
          </h1>
          <p className="agenda-screen-audience">
            {event.status === "cancelled" ? (
              <span className="agenda-cancelled">
                {translate("calendar.event.cancelled")}
              </span>
            ) : null}
            {audience === null ? null : describeAudience(translate, audience)}
          </p>
        </div>
        <WhenBlocks translate={translate} event={event} opened={opened} />
        <EventPlaceCard translate={translate} event={event} />
        {slots.rsvp}
        <OpenedSections
          translate={translate}
          detail={detail}
          tally={tally}
          onRetry={onRetry}
          goingVariant="screen"
        />
        {slots.teams}
        {slots.takeAttendance}
      </div>
    </article>
  );
}
