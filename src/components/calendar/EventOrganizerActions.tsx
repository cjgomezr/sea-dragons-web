import { CalendarBlank } from "@phosphor-icons/react/dist/ssr/CalendarBlank";
import { Repeat } from "@phosphor-icons/react/dist/ssr/Repeat";
import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import { useEffect, useId, useRef, useState } from "react";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import type {
  AgendaEvent,
  EventSeriesSummary,
  NamedEventAudience,
} from "@/lib/events/event-agenda";
import { formatPanelDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import {
  type EventForm as EventFormValues,
  formFromEvent,
  formFromSeriesSession,
  listEventChanges,
  listFollowingChanges,
} from "./event-form";
import {
  type ManageNotice,
  type ManageSave,
  type ManageScope,
  type ManageTarget,
  cancelTarget,
  describeManageFailure,
  readClosedNotice,
  saveChanges,
} from "./event-manage-client";
import { EventDialog } from "./EventDialog";
import type { FormSubmission } from "./EventForm";

/**
 * "Editar" y "Cancelar" en la fila desplegada de un evento futuro (#316,
 * RF-11 y RF-12 del PRD de E7), para Admin y Committee. Editar reutiliza el
 * diálogo de crear (#313) con los datos del evento. En una sesión de una
 * serie, antes se elige si es solo esa o esa y las siguientes (#655, RF-12
 * del PRD de E24), que parte la serie desde ella. Cancelar pregunta si es
 * solo esta o toda la serie de hoy en adelante, y pide confirmación diciendo
 * cuántos habían dicho que van.
 *
 * Lo que termina (bien, o porque el evento ya no admitía cambios) se lo pasa
 * a la agenda, que lo anuncia y se vuelve a pedir: así la fila, o todas las
 * de la serie, enseñan lo que dice el servidor.
 */

export type EventOrganizer = {
  readonly onSettled: (eventId: string, notice: ManageNotice) => void;
};

type OrganizerAction = "edit" | "cancel";

type CancelStatus =
  | { readonly kind: "confirming" }
  | { readonly kind: "sending" }
  | ApiRequestFailure;

type ActionStep =
  | { readonly kind: "idle" }
  | { readonly kind: "choosingScope"; readonly action: OrganizerAction }
  | {
      readonly kind: "editing";
      readonly target: ManageTarget;
      readonly initialForm: EventFormValues;
    }
  | {
      readonly kind: "cancelling";
      readonly target: ManageTarget;
      readonly status: CancelStatus;
    };

const FINISHED: FormSubmission = { kind: "finished" };

/** La pregunta de un paso recibe el foco al aparecer, para que el lector de
 * pantalla la lea y el teclado siga desde ahí. */
function useFocusOnMount<
  Element extends HTMLElement,
>(): React.RefObject<Element | null> {
  const ref = useRef<Element>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

/** Una opción del selector: el nombre es su etiqueta, y la pista, si la
 * tiene, la describe sin alargar el nombre. */
function EditScopeOption({
  Glyph,
  label,
  hint,
  buttonRef,
  onChoose,
}: {
  readonly Glyph: PhosphorGlyph;
  readonly label: string;
  readonly hint: string | null;
  readonly buttonRef?: React.RefObject<HTMLButtonElement | null>;
  readonly onChoose: () => void;
}): React.JSX.Element {
  const labelId = useId();
  const hintId = useId();
  return (
    <button
      ref={buttonRef}
      type="button"
      className="agenda-edit-scope-option"
      aria-labelledby={labelId}
      aria-describedby={hint === null ? undefined : hintId}
      onClick={onChoose}
    >
      <span className="agenda-edit-scope-icon" aria-hidden="true">
        <Glyph focusable="false" size={18} />
      </span>
      <span className="agenda-edit-scope-text">
        <span id={labelId} className="agenda-edit-scope-label">
          {label}
        </span>
        {hint === null ? null : (
          <span id={hintId} className="agenda-edit-scope-hint">
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}

/** Qué se edita de una serie (#655). La primera opción recibe el foco, y
 * Cancelar o Escape vuelven a Editar; Escape no llega al panel, que si no
 * se cerraría con él. */
function EditScopeChoice({
  translate,
  sessionDay,
  onChoose,
  onBack,
}: {
  readonly translate: Translator;
  readonly sessionDay: string;
  readonly onChoose: (scope: ManageScope) => void;
  readonly onBack: () => void;
}): React.JSX.Element {
  const questionId = useId();
  const firstOptionRef = useFocusOnMount<HTMLButtonElement>();
  return (
    <div
      className="groups-confirm agenda-organizer-step"
      role="group"
      aria-labelledby={questionId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onBack();
        }
      }}
    >
      <p id={questionId} className="agenda-edit-scope-question">
        {translate("calendar.manage.editScope.question")}
      </p>
      <EditScopeOption
        Glyph={CalendarBlank}
        label={translate("calendar.manage.editScope.session")}
        hint={translate("calendar.manage.editScope.sessionHint", {
          date: formatPanelDay(translate.locale, sessionDay),
        })}
        buttonRef={firstOptionRef}
        onChoose={() => onChoose("event")}
      />
      <EditScopeOption
        Glyph={Repeat}
        label={translate("calendar.manage.editScope.following")}
        hint={null}
        onChoose={() => onChoose("series")}
      />
      <div className="groups-actions">
        <button type="button" className="admin-secondary" onClick={onBack}>
          {translate("calendar.manage.editScope.close")}
        </button>
      </div>
    </div>
  );
}

function CancelScopeChoice({
  translate,
  onChoose,
  onBack,
}: {
  readonly translate: Translator;
  readonly onChoose: (scope: ManageScope) => void;
  readonly onBack: () => void;
}): React.JSX.Element {
  const questionId = useId();
  const questionRef = useFocusOnMount<HTMLParagraphElement>();
  const scopes: readonly ManageScope[] = ["event", "series"];
  return (
    <div
      className="groups-confirm agenda-organizer-step"
      role="group"
      aria-labelledby={questionId}
    >
      <p
        id={questionId}
        ref={questionRef}
        className="groups-question"
        tabIndex={-1}
      >
        {translate("calendar.manage.scopeQuestion.cancel")}
      </p>
      <div className="groups-actions">
        {scopes.map((scope) => (
          <button
            key={scope}
            type="button"
            className="admin-secondary"
            onClick={() => onChoose(scope)}
          >
            {translate(`calendar.manage.scope.${scope}`)}
          </button>
        ))}
        <button type="button" className="admin-secondary" onClick={onBack}>
          {translate("calendar.manage.back")}
        </button>
      </div>
    </div>
  );
}

function CancelConfirmation({
  translate,
  scope,
  goingCount,
  status,
  onConfirm,
  onKeep,
}: {
  readonly translate: Translator;
  readonly scope: ManageScope;
  readonly goingCount: number;
  readonly status: CancelStatus;
  readonly onConfirm: () => void;
  readonly onKeep: () => void;
}): React.JSX.Element {
  const questionId = useId();
  const questionRef = useFocusOnMount<HTMLParagraphElement>();
  const isSending = status.kind === "sending";
  return (
    <div
      className="groups-confirm agenda-organizer-step"
      role="group"
      aria-labelledby={questionId}
    >
      <p
        id={questionId}
        ref={questionRef}
        className="groups-question"
        tabIndex={-1}
      >
        {translate(`calendar.manage.cancelQuestion.${scope}`, {
          count: goingCount,
        })}
      </p>
      {status.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {describeManageFailure(translate, status)}
        </p>
      ) : null}
      <div className="groups-actions">
        <button
          type="button"
          className="groups-danger"
          disabled={isSending}
          onClick={onConfirm}
        >
          {translate(
            isSending
              ? "calendar.manage.cancelling"
              : `calendar.manage.confirm.${scope}`,
          )}
        </button>
        <button
          type="button"
          className="admin-secondary"
          disabled={isSending}
          onClick={onKeep}
        >
          {translate("calendar.manage.keep")}
        </button>
      </div>
    </div>
  );
}

export function EventOrganizerActions({
  translate,
  event,
  details,
  goingCount,
  organizer,
}: {
  readonly translate: Translator;
  readonly event: AgendaEvent;
  /** Lo que trae la fila desplegada y el diálogo necesita. */
  readonly details: {
    readonly notes: string | null;
    readonly audience: NamedEventAudience;
    /** La imagen grande firmada, o null sin imagen (#644). */
    readonly coverUrl: string | null;
    /** Los días y la fecha final de su serie; nulo en un evento suelto. */
    readonly series: EventSeriesSummary | null;
  };
  /** Los que van según la fila, que ya cuenta la respuesta propia. */
  readonly goingCount: number;
  readonly organizer: EventOrganizer;
}): React.JSX.Element {
  const [step, setStep] = useState<ActionStep>({ kind: "idle" });
  const editRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Como en el formulario: el estado desactiva el botón en el siguiente
  // pintado, pero un doble clic llega antes.
  const isSendingRef = useRef(false);

  function targetFor(scope: ManageScope): ManageTarget {
    return scope === "series" && event.seriesId !== null
      ? { scope: "series", seriesId: event.seriesId }
      : { scope: "event", eventId: event.id };
  }

  function proceed(action: OrganizerAction, scope: ManageScope): void {
    const target = targetFor(scope);
    setStep(
      action === "edit"
        ? {
            kind: "editing",
            target,
            initialForm:
              target.scope === "series"
                ? formFromSeriesSession(event, details)
                : formFromEvent(event, details),
          }
        : { kind: "cancelling", target, status: { kind: "confirming" } },
    );
  }

  function start(action: OrganizerAction): void {
    if (event.seriesId === null) {
      proceed(action, "event");
      return;
    }
    setStep({ kind: "choosingScope", action });
  }

  function returnTo(action: OrganizerAction): void {
    setStep({ kind: "idle" });
    (action === "edit" ? editRef : cancelRef).current?.focus();
  }

  /** Lo que terminó se lo pasa a la agenda; lo que se puede reintentar,
   * no. */
  function settle(result: ManageSave): FormSubmission {
    if (result.kind === "saved") {
      organizer.onSettled(event.id, result.notice);
      return FINISHED;
    }
    const closed = readClosedNotice(result);
    if (closed === null) {
      return result;
    }
    organizer.onSettled(event.id, closed);
    return FINISHED;
  }

  /** Una serie se edita desde esta sesión: se parte desde aquí (#653). */
  async function submitEdit(
    target: ManageTarget,
    initialForm: EventFormValues,
    form: EventFormValues,
  ): Promise<FormSubmission> {
    const changes =
      target.scope === "event"
        ? listEventChanges(initialForm, form)
        : listFollowingChanges(initialForm, form);
    if (Object.keys(changes).length === 0) {
      return FINISHED;
    }
    return settle(
      await saveChanges(
        target,
        target.scope === "event"
          ? changes
          : { ...changes, fromOccurrenceId: event.id },
      ),
    );
  }

  /** La serie cambió por otro lado: la agenda la vuelve a pedir. */
  function reloadSeries(): void {
    organizer.onSettled(event.id, {
      kind: "closed",
      reason: "session_not_in_series",
    });
  }

  async function confirmCancel(target: ManageTarget): Promise<void> {
    if (isSendingRef.current) {
      return;
    }
    isSendingRef.current = true;
    setStep({ kind: "cancelling", target, status: { kind: "sending" } });
    const outcome = settle(await cancelTarget(target));
    isSendingRef.current = false;
    if (outcome.kind === "failed") {
      setStep({ kind: "cancelling", target, status: outcome });
    }
  }

  const isCancelSending =
    step.kind === "cancelling" && step.status.kind === "sending";

  return (
    <div className="agenda-organizer">
      {step.kind === "choosingScope" && step.action === "edit" ? (
        <EditScopeChoice
          translate={translate}
          sessionDay={event.startsOn}
          onChoose={(scope) => proceed("edit", scope)}
          onBack={() => returnTo("edit")}
        />
      ) : null}
      <div className="groups-actions">
        <button
          ref={editRef}
          type="button"
          className="admin-secondary"
          disabled={isCancelSending}
          onClick={() => start("edit")}
        >
          {translate("calendar.manage.edit")}
        </button>
        <button
          ref={cancelRef}
          type="button"
          className="groups-danger"
          disabled={isCancelSending}
          onClick={() => start("cancel")}
        >
          {translate("calendar.manage.cancel")}
        </button>
      </div>
      {step.kind === "choosingScope" && step.action === "cancel" ? (
        <CancelScopeChoice
          translate={translate}
          onChoose={(scope) => proceed("cancel", scope)}
          onBack={() => returnTo("cancel")}
        />
      ) : null}
      {step.kind === "cancelling" ? (
        <CancelConfirmation
          translate={translate}
          scope={step.target.scope}
          goingCount={goingCount}
          status={step.status}
          onConfirm={() => void confirmCancel(step.target)}
          onKeep={() => returnTo("cancel")}
        />
      ) : null}
      {step.kind === "editing" ? (
        <EventDialog
          translate={translate}
          layout={step.target.scope}
          initialForm={step.initialForm}
          currentCoverUrl={details.coverUrl}
          submit={(form) => submitEdit(step.target, step.initialForm, form)}
          onReload={reloadSeries}
          onClosed={() => returnTo("edit")}
        />
      ) : null}
    </div>
  );
}
