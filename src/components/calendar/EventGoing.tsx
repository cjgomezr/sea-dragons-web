import { useId, useState } from "react";
import type { Translator } from "@/lib/i18n/translator";
import type { EventTally, OpenedEvent } from "./agenda-client";

/**
 * Los que van en el panel del evento (#648, RF-7 del PRD de E24): "GOING ·
 * n" con los quizás al lado, hasta siete avatares con iniciales, "+n más" y
 * "Ver todos", que abre la lista de nombres de quién va y quién quizás.
 *
 * Los conteos son los de la fila, que ya cuentan la respuesta propia; los
 * nombres, los del detalle. Cada avatar lleva el nombre entero para el lector
 * de pantalla: las iniciales sólo se ven.
 */

const MAX_AVATARS = 7;

/** "Lucía Fernández" → "LF"; un solo nombre, su inicial. */
export function initialsOf(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const first = words.at(0) ?? "";
  const last = words.length > 1 ? (words.at(-1) ?? "") : "";
  return `${[...first].at(0) ?? ""}${[...last].at(0) ?? ""}`.toLocaleUpperCase();
}

function NameList({
  label,
  names,
  whenEmpty,
}: {
  readonly label: string;
  readonly names: readonly string[];
  readonly whenEmpty: string;
}): React.JSX.Element {
  if (names.length === 0) {
    return <p className="agenda-detail-empty">{whenEmpty}</p>;
  }
  return (
    <ul className="agenda-names" aria-label={label}>
      {names.map((name, index) => (
        // Dos socios pueden llamarse igual: el nombre solo no es una clave.
        <li key={`${index}-${name}`}>{name}</li>
      ))}
    </ul>
  );
}

function AllNames({
  translate,
  opened,
  id,
}: {
  readonly translate: Translator;
  readonly opened: OpenedEvent;
  readonly id: string;
}): React.JSX.Element {
  const nobodyYet = translate("calendar.detail.nobodyYet");
  return (
    <dl id={id} className="agenda-detail-list">
      <div className="agenda-detail-item">
        <dt>{translate("calendar.detail.going")}</dt>
        <dd>
          <NameList
            label={translate("calendar.detail.going")}
            names={opened.going}
            whenEmpty={nobodyYet}
          />
        </dd>
      </div>
      <div className="agenda-detail-item">
        <dt>{translate("calendar.detail.maybe")}</dt>
        <dd>
          <NameList
            label={translate("calendar.detail.maybe")}
            names={opened.maybe}
            whenEmpty={nobodyYet}
          />
        </dd>
      </div>
    </dl>
  );
}

function Avatars({
  translate,
  names,
  labelId,
}: {
  readonly translate: Translator;
  readonly names: readonly string[];
  readonly labelId: string;
}): React.JSX.Element {
  const shown = names.slice(0, MAX_AVATARS);
  const hiddenCount = names.length - shown.length;
  return (
    <div className="agenda-avatars-row">
      <ul className="agenda-avatars" aria-labelledby={labelId}>
        {shown.map((name, index) => (
          <li key={`${index}-${name}`} className="agenda-avatar">
            <span aria-hidden="true">{initialsOf(name)}</span>
            <span className="visually-hidden">{name}</span>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <span className="agenda-avatars-more">
          {translate("calendar.panel.moreGoing", { count: hiddenCount })}
        </span>
      ) : null}
    </div>
  );
}

export function EventGoing({
  translate,
  tally,
  opened,
}: {
  readonly translate: Translator;
  readonly tally: Pick<EventTally, "goingCount" | "maybeCount">;
  readonly opened: OpenedEvent;
}): React.JSX.Element {
  const [isListOpen, setIsListOpen] = useState(false);
  const headingId = useId();
  const listId = useId();
  const hasResponses = opened.going.length > 0 || opened.maybe.length > 0;
  return (
    <section className="agenda-panel-section agenda-going-section">
      <div className="agenda-panel-section-header">
        <h3 id={headingId} className="agenda-panel-eyebrow">
          {translate("calendar.panel.goingHeading", {
            count: tally.goingCount,
          })}
        </h3>
        <span className="agenda-going-maybe">
          {translate("calendar.event.maybe", { count: tally.maybeCount })}
        </span>
      </div>
      {hasResponses ? null : (
        <p className="agenda-detail-empty">
          {translate("calendar.detail.noResponses")}
        </p>
      )}
      {hasResponses ? (
        <div className="agenda-going-people">
          <Avatars
            translate={translate}
            names={opened.going}
            labelId={headingId}
          />
          <button
            type="button"
            className="agenda-see-all"
            aria-expanded={isListOpen}
            aria-controls={listId}
            onClick={() => setIsListOpen((isOpen) => !isOpen)}
          >
            {translate("calendar.panel.seeAll")}
          </button>
        </div>
      ) : null}
      {hasResponses && isListOpen ? (
        <AllNames translate={translate} opened={opened} id={listId} />
      ) : null}
    </section>
  );
}
