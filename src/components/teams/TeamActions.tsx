import { useEffect, useId, useRef } from "react";
import type { Translator } from "@/lib/i18n/translator";
import { describeTeamsFailure } from "./team-builder-client";
import type { BuilderAction } from "./use-team-builder";

/**
 * Guardar y publicar el reparto (#402, RF-4 y RF-7), y lo que la pantalla
 * dice cuando terminan. Publicar pide confirmación en la misma página, como
 * cancelar un evento en el calendario, diciendo a cuántos se avisará.
 */

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
          <>
            {" · "}
            <span className="team-unsaved">{translate("teams.unsaved")}</span>
          </>
        ) : null}
      </button>
      <button
        type="button"
        className="auth-submit team-publish"
        disabled={assignedCount === 0}
        onClick={onAskToPublish}
      >
        {translate("teams.publish")}
      </button>
    </div>
  );
}

/** La pregunta recibe el foco al aparecer, para que el lector de pantalla la
 * lea y el teclado siga desde ahí. */
export function PublishConfirmation({
  translate,
  assignedCount,
  wasPublished,
  isPublishing,
  onConfirm,
  onCancel,
}: {
  readonly translate: Translator;
  readonly assignedCount: number;
  /** Volver a publicar sólo avisa a quien cambió (D6). */
  readonly wasPublished: boolean;
  readonly isPublishing: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
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
      <p
        id={questionId}
        ref={questionRef}
        className="groups-question"
        tabIndex={-1}
      >
        {translate(
          wasPublished ? "teams.republishQuestion" : "teams.publishQuestion",
          { count: assignedCount },
        )}
      </p>
      <div className="groups-actions">
        <button
          type="button"
          className="auth-submit"
          aria-busy={isPublishing}
          onClick={onConfirm}
        >
          {translate(
            isPublishing ? "teams.publishing" : "teams.publishConfirm",
          )}
        </button>
        <button type="button" className="admin-secondary" onClick={onCancel}>
          {translate("teams.publishCancel")}
        </button>
      </div>
    </div>
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
  return (
    <>
      <p className="team-notice" role="status">
        {statusText(translate, action)}
      </p>
      {action.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {describeTeamsFailure(translate, action.failure)}
        </p>
      ) : null}
    </>
  );
}
