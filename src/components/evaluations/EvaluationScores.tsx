import type { EvaluationCategories } from "@/lib/evaluations/evaluation-categories";
import type { MemberEvaluation } from "@/lib/evaluations/member-evaluation";
import { formatClubShortDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { EvaluationRatings } from "./EvaluationRatings";
import { EvaluationRefreshOffer } from "./EvaluationRefreshOffer";
import {
  describeEvaluationFailure,
  isStaleEvaluation,
} from "./evaluations-client";
import { type RatingsEditor, useRatingsEditor } from "./use-ratings-editor";

/**
 * Una evaluación que existe (#322): las categorías con su barra y su número
 * y, al pie, cuándo y quién la actualizó con el botón de editar (#819, RF-3
 * del PRD de E31). El OVR va arriba, con la identidad del jugador. La
 * edición sigue siendo la de E9 hasta que #820 la rehaga.
 */

type Evaluated = Extract<MemberEvaluation, { status: "evaluated" }>;

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
      {isStaleEvaluation(status.failure) ? (
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

/** "Actualizada {fecha} por {nombre}"; sólo la fecha si no se sabe quién
 * (D6). */
function UpdatedNote({
  translate,
  updatedAt,
  updatedBy,
}: {
  translate: Translator;
  updatedAt: string;
  updatedBy: string | null;
}): React.JSX.Element {
  const date = formatClubShortDay(translate.locale, new Date(updatedAt));
  return (
    <p className="evaluation-updated">
      {updatedBy === null
        ? translate("evaluations.sheet.updated", { date })
        : translate("evaluations.sheet.updatedBy", { date, name: updatedBy })}
    </p>
  );
}

export function EvaluationScores({
  translate,
  evaluation,
  categories,
  updatedBy,
  isEditingAtStart,
  onSaved,
  onRefreshed,
  onReload,
}: {
  translate: Translator;
  evaluation: Evaluated;
  categories: EvaluationCategories | null;
  /** Quién hizo la última edición, si se sabe. */
  updatedBy: string | null;
  /** Recién creada, se abre ya para ajustar: es a lo que se venía. */
  isEditingAtStart: boolean;
  onSaved: (evaluation: MemberEvaluation) => void;
  onRefreshed: (evaluation: MemberEvaluation) => void;
  onReload: () => void;
}): React.JSX.Element {
  const editor = useRatingsEditor({ evaluation, isEditingAtStart, onSaved });
  // Poner al día con valoraciones a medio ajustar tiraría lo ajustado: la
  // oferta sólo sale fuera de la edición.
  const isEditing = editor.draft !== null;
  return (
    <div className="evaluation-scores">
      <EvaluationRatings
        translate={translate}
        ratings={evaluation.ratings}
        categories={categories}
        draft={editor.draft}
        onDraftChange={editor.setDraft}
      />
      <SaveStatusMessage
        translate={translate}
        editor={editor}
        onReload={onReload}
      />
      {isEditing ? null : (
        <EvaluationRefreshOffer
          translate={translate}
          evaluation={evaluation}
          onRefreshed={onRefreshed}
        />
      )}
      <footer className="evaluation-sheet-footer">
        {isEditing ? null : (
          <UpdatedNote
            translate={translate}
            updatedAt={evaluation.updatedAt}
            updatedBy={updatedBy}
          />
        )}
        <EditActions translate={translate} editor={editor} />
      </footer>
    </div>
  );
}
