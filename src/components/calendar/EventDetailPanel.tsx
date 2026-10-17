import { Clock } from "@phosphor-icons/react/dist/ssr/Clock";
import { Repeat } from "@phosphor-icons/react/dist/ssr/Repeat";
import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import { useEffect, useId, useRef } from "react";
import type {
  AgendaEvent,
  NamedEventAudience,
} from "@/lib/events/event-agenda";
import type { Translator } from "@/lib/i18n/translator";
import {
  type EventTally,
  type OpenedEvent,
  describeOpeningFailure,
} from "./agenda-client";
import { AddToCalendarButton } from "./AddToCalendarButton";
import { EventCover } from "./EventCover";
import { EventGoing } from "./EventGoing";
import { EventPlaceCard } from "./EventPlaceCard";
import { EventTypeTag } from "./EventTypeTag";
import { describeEventWhen, describeSeriesRepeat } from "./event-panel-text";
import type { EventDetailState } from "./use-event-detail";

/**
 * El panel del evento elegido en la agenda (#648, RF-7 del PRD de E24), que
 * sustituye al acordeón de #312. De arriba abajo: la imagen o el fondo del
 * tipo con su barra, la etiqueta y la audiencia, el título, la hora, la
 * repetición de una serie, el lugar, "¿Vas?", los que van, las notas, los
 * equipos y las acciones.
 *
 * Lo que trae la agenda se pinta en cuanto se elige la fila; lo del detalle
 * (la imagen grande, la repetición, los nombres, las notas y la audiencia)
 * llega después. Mientras, la miniatura hace de imagen. El RSVP, los equipos
 * y las acciones los pone la fila, que es dueña de su estado.
 */

/** Cómo entra y sale el foco del panel (#648, RNF de accesibilidad del PRD
 * de E24): al elegir una fila con un gesto va al título; Escape o "Volver a
 * la lista" lo devuelven a la fila. */
export type PanelFocus = {
  readonly shouldTakeFocus: boolean;
  readonly onReturn: () => void;
};

/** Lo que la fila pone en su sitio del panel. */
export type PanelSlots = {
  readonly rsvp: React.ReactNode;
  readonly teams: React.ReactNode;
  readonly actions: React.ReactNode;
};

const AUDIENCE_SEPARATOR = " · ";

function hasNotes(notes: string | null): notes is string {
  return notes !== null && notes.trim() !== "";
}

function describeAudience(
  translate: Translator,
  audience: NamedEventAudience,
): string {
  if (audience.kind === "club") {
    return translate("calendar.detail.audience.club");
  }
  if (audience.groups.length === 0) {
    return translate("calendar.detail.audience.noGroups");
  }
  return audience.groups.map((group) => group.name).join(AUDIENCE_SEPARATOR);
}

function openedOf(detail: EventDetailState): OpenedEvent | null {
  return detail.kind === "loaded" ? detail.opened : null;
}

/** Un bloque con su icono en un cuadro y dos líneas, como la hora, y un
 * botón al final si lo lleva. */
function PanelBlock({
  Glyph,
  lines,
  action = null,
}: {
  readonly Glyph: PhosphorGlyph;
  readonly lines: { readonly first: string; readonly second: string };
  readonly action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="agenda-panel-block">
      <span className="agenda-panel-icon" aria-hidden="true">
        <Glyph focusable="false" size={18} />
      </span>
      <div className="agenda-panel-block-text">
        <p className="agenda-panel-block-first">{lines.first}</p>
        <p className="agenda-panel-block-second">{lines.second}</p>
      </div>
      {action}
    </div>
  );
}

function PanelTags({
  translate,
  event,
  opened,
}: {
  readonly translate: Translator;
  readonly event: AgendaEvent;
  readonly opened: OpenedEvent | null;
}): React.JSX.Element {
  const audience = opened === null ? null : opened.audience;
  return (
    <div className="agenda-panel-tags">
      <EventTypeTag translate={translate} eventType={event.eventType} />
      {event.status === "cancelled" ? (
        <span className="agenda-cancelled">
          {translate("calendar.event.cancelled")}
        </span>
      ) : null}
      {audience === null ? null : (
        <span className="agenda-panel-audience">
          {describeAudience(translate, audience)}
        </span>
      )}
    </div>
  );
}

function WhenBlocks({
  translate,
  event,
  opened,
}: {
  readonly translate: Translator;
  readonly event: AgendaEvent;
  readonly opened: OpenedEvent | null;
}): React.JSX.Element {
  const when = describeEventWhen(translate, event);
  const series = opened === null ? null : opened.series;
  const repeat =
    series === null ? null : describeSeriesRepeat(translate, series);
  return (
    <>
      <PanelBlock
        Glyph={Clock}
        lines={{ first: when.day, second: when.hours }}
        action={
          <AddToCalendarButton
            translate={translate}
            event={event}
            notes={opened === null ? null : opened.notes}
          />
        }
      />
      {repeat === null ? null : (
        <PanelBlock
          Glyph={Repeat}
          lines={{ first: repeat.days, second: repeat.until }}
        />
      )}
    </>
  );
}

/** Los que van y las notas, que llegan con el detalle. */
function OpenedSections({
  translate,
  detail,
  tally,
  onRetry,
}: {
  readonly translate: Translator;
  readonly detail: EventDetailState;
  readonly tally: EventTally;
  readonly onRetry: () => void;
}): React.JSX.Element | null {
  switch (detail.kind) {
    case "idle":
      return null;
    case "loading":
      return (
        <p className="agenda-detail-empty">
          {translate("calendar.detail.loading")}
        </p>
      );
    case "failed":
      return (
        <div className="agenda-detail-failure">
          <p className="auth-error" role="alert">
            {describeOpeningFailure(translate, detail.failure)}
          </p>
          <button type="button" className="admin-secondary" onClick={onRetry}>
            {translate("calendar.retry")}
          </button>
        </div>
      );
    case "loaded":
      return (
        <>
          <EventGoing
            translate={translate}
            tally={tally}
            opened={detail.opened}
          />
          {hasNotes(detail.opened.notes) ? (
            <section className="agenda-panel-section">
              <h3 className="agenda-panel-eyebrow">
                {translate("calendar.detail.notes")}
              </h3>
              <p className="agenda-detail-notes">{detail.opened.notes}</p>
            </section>
          ) : null}
        </>
      );
  }
}

export function EventDetailPanel({
  id,
  translate,
  event,
  detail,
  tally,
  onRetry,
  slots,
  focus,
}: {
  readonly id: string;
  readonly translate: Translator;
  readonly event: AgendaEvent;
  readonly detail: EventDetailState;
  /** Los conteos de la fila, que ya cuentan la respuesta propia. */
  readonly tally: EventTally;
  readonly onRetry: () => void;
  readonly slots: PanelSlots;
  readonly focus: PanelFocus;
}): React.JSX.Element {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const opened = openedOf(detail);
  const { shouldTakeFocus, onReturn } = focus;

  useEffect(() => {
    if (shouldTakeFocus) {
      titleRef.current?.focus();
    }
  }, [shouldTakeFocus]);

  // Escape dentro de un diálogo (editar) lo cierra a él, no al panel.
  function returnOnEscape(keyDown: React.KeyboardEvent<HTMLElement>): void {
    const target = keyDown.target;
    const isInDialog = target instanceof Element && target.closest("dialog");
    if (keyDown.key === "Escape" && !isInDialog) {
      onReturn();
    }
  }

  return (
    <aside
      id={id}
      className={`agenda-panel agenda-panel-${event.eventType}`}
      aria-labelledby={titleId}
      onKeyDown={returnOnEscape}
    >
      <div className="agenda-panel-cover">
        <EventCover
          url={opened === null ? event.coverThumbUrl : opened.coverUrl}
          eventType={event.eventType}
          iconSize={76}
        />
      </div>
      <div className="agenda-panel-body">
        <PanelTags translate={translate} event={event} opened={opened} />
        <h2
          ref={titleRef}
          id={titleId}
          className="agenda-panel-title"
          tabIndex={-1}
        >
          {event.title}
        </h2>
        <WhenBlocks translate={translate} event={event} opened={opened} />
        <EventPlaceCard translate={translate} event={event} />
        {slots.rsvp}
        <OpenedSections
          translate={translate}
          detail={detail}
          tally={tally}
          onRetry={onRetry}
        />
        {slots.teams}
        {slots.actions}
        <button type="button" className="agenda-panel-back" onClick={onReturn}>
          {translate("calendar.panel.backToList")}
        </button>
      </div>
    </aside>
  );
}
