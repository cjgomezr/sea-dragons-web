import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr/PaperPlaneTilt";
import { useEffect, useId, useRef } from "react";
import { BottomSheet } from "@/components/directory/BottomSheet";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";
import { describeTeamsFailure } from "./team-builder-client";
import type { BuilderAction } from "./use-team-builder";

/**
 * Guardar y publicar el reparto (#402, RF-4 y RF-7), y lo que la pantalla
 * dice cuando terminan. Publicar pide confirmación en la misma página, como
 * cancelar un evento en el calendario, diciendo a cuántos se avisará. La
 * forma es la del handoff de E28 (#758): Guardar marca con un punto lo que
 * falta por guardar y los avisos son una línea con un check. En el móvil
 * (#762) la pregunta sube en una hoja inferior, con el mismo texto.
 */

type PublishQuestion = {
  readonly translate: Translator;
  readonly assignedCount: number;
  /** Volver a publicar sólo avisa a quien cambió (D6). */
  readonly wasPublished: boolean;
  readonly isPublishing: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

function publishQuestion({
  translate,
  wasPublished,
  assignedCount,
}: PublishQuestion): string {
  return translate(
    wasPublished ? "teams.republishQuestion" : "teams.publishQuestion",
    { count: assignedCount },
  );
}

/** Cancelar y Publicar: lo mismo en la tarjeta y en la hoja. */
function PublishChoices({
  translate,
  isPublishing,
  onConfirm,
  onCancel,
}: Omit<PublishQuestion, "assignedCount" | "wasPublished">): React.JSX.Element {
  return (
    <div className="groups-actions">
      <button type="button" className="admin-secondary" onClick={onCancel}>
        {translate("teams.publishCancel")}
      </button>
      <button
        type="button"
        className="auth-submit"
        aria-busy={isPublishing}
        onClick={onConfirm}
      >
        {translate(isPublishing ? "teams.publishing" : "teams.publishConfirm")}
      </button>
    </div>
  );
}

/** El foco quedó en ningún sitio: en el body, porque lo que lo tenía se fue. */
function hasLostFocus(): boolean {
  return (
    document.activeElement === null || document.activeElement === document.body
  );
}

export function SaveAndPublish({
  translate,
  action,
  hasChanges,
  assignedCount,
  onSave,
  onAskToPublish,
}: {
  readonly translate: Translator;
  readonly action: BuilderAction;
  readonly hasChanges: boolean;
  readonly assignedCount: number;
  readonly onSave: () => void;
  readonly onAskToPublish: () => void;
}): React.JSX.Element {
  const isSaving = action.kind === "saving";
  const publishRef = useRef<HTMLButtonElement>(null);
  const isPublished = action.kind === "published";
  // Al publicar se va la pregunta (la tarjeta o la hoja) que tenía el foco, y
  // el foco caería al body: vuelve a Publicar, de donde salió.
  useEffect(() => {
    if (isPublished && hasLostFocus()) {
      publishRef.current?.focus();
    }
  }, [isPublished]);
  return (
    <div className="team-actions">
      <button
        type="button"
        className="admin-secondary team-save"
        aria-busy={isSaving}
        onClick={onSave}
      >
        {translate(isSaving ? "teams.saving" : "teams.save")}
        {hasChanges && !isSaving ? (
          // El punto se ve; el separador sólo se oye.
          <>
            {" "}
            <span className="visually-hidden">·</span>{" "}
            <span className="team-unsaved">
              <span className="team-unsaved-dot" aria-hidden="true" />
              <span className="team-unsaved-label">
                {translate("teams.unsaved")}
              </span>
            </span>
          </>
        ) : null}
      </button>
      <button
        ref={publishRef}
        type="button"
        className="auth-submit team-publish"
        disabled={assignedCount === 0}
        onClick={onAskToPublish}
      >
        <Icon glyph={PaperPlaneTilt} />
        {translate("teams.publish")}
      </button>
    </div>
  );
}

/** La pregunta recibe el foco al aparecer, para que el lector de pantalla la
 * lea y el teclado siga desde ahí. */
export function PublishConfirmation(
  question: PublishQuestion,
): React.JSX.Element {
  const questionId = useId();
  const questionRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    questionRef.current?.focus();
  }, []);
  return (
    <div
      className="groups-confirm team-confirm"
      role="group"
      aria-labelledby={questionId}
    >
      <span className="team-confirm-icon">
        <Icon glyph={PaperPlaneTilt} />
      </span>
      <p
        id={questionId}
        ref={questionRef}
        className="groups-question"
        tabIndex={-1}
      >
        {publishQuestion(question)}
      </p>
      <PublishChoices {...question} />
    </div>
  );
}

/** La pregunta en la hoja inferior del móvil. Mientras está abierta, el foco
 * no sale de ella; Escape o un toque fuera cancelan, como Cancelar. */
export function PublishSheet(question: PublishQuestion): React.JSX.Element {
  return (
    <BottomSheet
      title={(titleId) => (
        <div className="team-publish-sheet-heading">
          <span className="team-confirm-icon">
            <Icon glyph={PaperPlaneTilt} />
          </span>
          <h2 id={titleId} className="team-publish-sheet-title">
            {publishQuestion(question)}
          </h2>
        </div>
      )}
      onClosed={question.onCancel}
    >
      {(close) => (
        <div className="team-publish-sheet">
          <PublishChoices {...question} onCancel={close} />
        </div>
      )}
    </BottomSheet>
  );
}

function statusText(translate: Translator, action: BuilderAction): string {
  switch (action.kind) {
    case "balanced":
      return translate("teams.balanced");
    case "saved":
      return translate("teams.saved");
    case "published":
      return translate("teams.published", { count: action.notifiedCount });
    case "teamsChanged":
      return translate(
        action.keptByPublished
          ? "teams.edit.changedKeptByPublished"
          : "teams.edit.changed",
      );
    default:
      return "";
  }
}

/** El `status` siempre está en el DOM: un lector de pantalla sólo anuncia
 * los cambios de una región que ya estaba. */
export function ActionNotices({
  translate,
  action,
}: {
  readonly translate: Translator;
  readonly action: BuilderAction;
}): React.JSX.Element {
  const notice = statusText(translate, action);
  return (
    <>
      <p className="team-notice" role="status">
        {notice === "" ? null : (
          <>
            <Icon glyph={Check} weight="bold" />
            {notice}
          </>
        )}
      </p>
      {action.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {describeTeamsFailure(translate, action.failure)}
        </p>
      ) : null}
    </>
  );
}
