import type { MemberEvaluation } from "@/lib/evaluations/member-evaluation";
import { formatOverallRating } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { EvaluationRatings } from "./EvaluationRatings";
import {
  describeEvaluationFailure,
  isEvaluationChanged,
} from "./evaluations-client";
import { type RatingsEditor, useRatingsEditor } from "./use-ratings-editor";

/**
 * Una evaluación que existe (#322): el OVR grande, las categorías con su
 * barra y su número, y el botón de editar, como el mockup. La tarjeta de
 * "Position score" del mockup no está: la v1.1 del SRD la sustituyó por las
 * categorías configurables (PRD, fuera de alcance).
 */

type Evaluated = Extract<MemberEvaluation, { status: "evaluated" }>;

function OverallScore({
  translate,
  overallRating,
}: {
  translate: Translator;
  overallRating: number | null;
}): React.JSX.Element {
  return (
    <div className="card evaluation-overall">
      <h3 className="evaluation-card-title">
        {translate("evaluations.overall.title")}
      </h3>
      {overallRating === null ? (
        <p className="evaluation-overall-empty">
          {translate("evaluations.overall.noData")}
        </p>
      ) : (
        <>
          <p className="evaluation-overall-value">
            {formatOverallRating(translate.locale, overallRating)}
          </p>
          <p className="evaluation-overall-scale">
            {translate("evaluations.overall.outOf")}
          </p>
        </>
      )}
    </div>
  );
}

function SaveStatusMessage({
  translate,
  editor,
  onReload,
}: {
  translate: Translator;
  editor: RatingsEditor;
  onReload: () => void;
}): React.JSX.Element | null {
  const { status } = editor;
  if (status.kind === "saved") {
    return (
      <p className="admin-notice" role="status">
        {translate("evaluations.saved")}
      </p>
    );
  }
  if (status.kind !== "failed") {
    return null;
  }
  return (
    <div className="auth-error evaluation-save-error" role="alert">
      <p>{describeEvaluationFailure(translate, status.failure)}</p>
      {isEvaluationChanged(status.failure) ? (
        <button type="button" className="admin-secondary" onClick={onReload}>
          {translate("evaluations.reload")}
        </button>
      ) : null}
    </div>
  );
}

function EditActions({
  translate,
  editor,
}: {
  translate: Translator;
  editor: RatingsEditor;
}): React.JSX.Element {
  if (editor.draft === null) {
    return (
      <div className="evaluation-actions">
        <button
          type="button"
          className="admin-secondary"
          onClick={editor.startEditing}
        >
          {translate("evaluations.edit")}
        </button>
      </div>
    );
  }
  const isSaving = editor.status.kind === "saving";
  return (
    <div className="evaluation-actions">
      <button
        type="button"
        className="auth-submit"
        disabled={isSaving}
        onClick={() => void editor.save()}
      >
        {translate(isSaving ? "evaluations.saving" : "evaluations.save")}
      </button>
      <button
        type="button"
        className="admin-secondary"
        disabled={isSaving}
        onClick={editor.cancelEditing}
      >
        {translate("evaluations.cancel")}
      </button>
    </div>
  );
}

export function EvaluationScores({
  translate,
  evaluation,
  isEditingAtStart,
  onSaved,
  onReload,
}: {
  translate: Translator;
  evaluation: Evaluated;
  /** Recién creada, se abre ya para ajustar: es a lo que se venía. */
  isEditingAtStart: boolean;
  onSaved: (evaluation: MemberEvaluation) => void;
  onReload: () => void;
}): React.JSX.Element {
  const editor = useRatingsEditor({ evaluation, isEditingAtStart, onSaved });
  return (
    <div className="evaluation-scores">
      <div className="evaluation-summary">
        <OverallScore
          translate={translate}
          overallRating={evaluation.overallRating}
        />
        <EditActions translate={translate} editor={editor} />
        <SaveStatusMessage
          translate={translate}
          editor={editor}
          onReload={onReload}
        />
      </div>
      <EvaluationRatings
        translate={translate}
        ratings={evaluation.ratings}
        draft={editor.draft}
        onDraftChange={editor.setDraft}
      />
    </div>
  );
}
