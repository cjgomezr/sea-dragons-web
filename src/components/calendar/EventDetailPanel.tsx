import type { NamedEventAudience } from "@/lib/events/event-agenda";
import type { Translator } from "@/lib/i18n/translator";
import { type OpenedEvent, describeOpeningFailure } from "./agenda-client";
import type { EventDetailState } from "./use-event-detail";

/**
 * Lo que enseña una fila desplegada de la agenda (#312, RF-6 y RF-8): las
 * notas, quién va y quién quizás, y a quien organiza también la audiencia.
 * Ningún apartado se queda en blanco: si no hay nada, una frase lo dice.
 */

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

function Responses({
  translate,
  opened,
}: {
  readonly translate: Translator;
  readonly opened: OpenedEvent;
}): React.JSX.Element {
  if (opened.going.length === 0 && opened.maybe.length === 0) {
    return (
      <div className="agenda-detail-item">
        <dt>{translate("calendar.detail.responses")}</dt>
        <dd className="agenda-detail-empty">
          {translate("calendar.detail.noResponses")}
        </dd>
      </div>
    );
  }
  const nobodyYet = translate("calendar.detail.nobodyYet");
  return (
    <>
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
    </>
  );
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
  return audience.groups.map((group) => group.name).join(", ");
}

function OpenedDetail({
  translate,
  opened,
}: {
  readonly translate: Translator;
  readonly opened: OpenedEvent;
}): React.JSX.Element {
  return (
    <dl className="agenda-detail-list">
      <div className="agenda-detail-item">
        <dt>{translate("calendar.detail.notes")}</dt>
        {opened.notes === null || opened.notes.trim() === "" ? (
          <dd className="agenda-detail-empty">
            {translate("calendar.detail.noNotes")}
          </dd>
        ) : (
          <dd className="agenda-detail-notes">{opened.notes}</dd>
        )}
      </div>
      <Responses translate={translate} opened={opened} />
      {opened.audience === null ? null : (
        <div className="agenda-detail-item">
          <dt>{translate("calendar.detail.audience")}</dt>
          <dd>{describeAudience(translate, opened.audience)}</dd>
        </div>
      )}
    </dl>
  );
}

export function EventDetailPanel({
  translate,
  detail,
  onRetry,
}: {
  readonly translate: Translator;
  readonly detail: EventDetailState;
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
      return <OpenedDetail translate={translate} opened={detail.opened} />;
  }
}
