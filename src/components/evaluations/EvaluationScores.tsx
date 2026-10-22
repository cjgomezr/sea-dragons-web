import type { EvaluationCategories } from "@/lib/evaluations/evaluation-categories";
import type { MemberEvaluation } from "@/lib/evaluations/member-evaluation";
import { formatClubShortDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { EvaluationRatings } from "./EvaluationRatings";
import {
  describeEvaluationFailure,
  isStaleEvaluation,
} from "./evaluations-client";
import type { RatingsEditor, SaveIntent } from "./use-ratings-editor";

/**
 * Una evaluación que existe (#322): las categorías con su barra y su número
 * y, al pie, cuándo y quién la actualizó con el botón de editar (#819, RF-3
 * del PRD de E31). En edición (#820) el pie lleva Cancelar, Guardar y
 * Guardar y siguiente. El OVR va arriba, con la identidad del jugador, y la
 * edición vive en la ficha para que lo recalcule en vivo.
 */

type Evaluated = Extract<MemberEvaluation, { status: "evaluated" }>;

function SaveFailure({
  translate,
  editor,
  onReload,
}: {
  translate: Translator;
  editor: RatingsEditor;
  onReload: () => void;
}): React.JSX.Element | null {
  const { status } = editor;
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

/** "Guardando…" en el botón que se pulsó; los dos quedan deshabilitados. */
function saveLabel(
  translate: Translator,
  editor: RatingsEditor,
  intent: SaveIntent,
): string {
  const { status } = editor;
  if (status.kind === "saving" && status.intent === intent) {
    return translate("evaluations.saving");
  }
  return translate(
    intent === "advance" ? "evaluations.saveAndNext" : "evaluations.save",
  );
}

function EditingActions({
  translate,
  editor,
  hasNext,
}: {
  translate: Translator;
  editor: RatingsEditor;
  hasNext: boolean;
}): React.JSX.Element {
  const isSaving = editor.status.kind === "saving";
  return (
    <div className="evaluation-actions">
      <button
        type="button"
        className="evaluation-cancel"
        disabled={isSaving}
        onClick={editor.cancelEditing}
      >
        {translate("evaluations.cancel")}
      </button>
      <button
        type="button"
        className="admin-secondary"
        disabled={isSaving}
        onClick={() => void editor.save("stay")}
      >
        {saveLabel(translate, editor, "stay")}
      </button>
      <button
        type="button"
        className="auth-submit evaluation-save-next"
        disabled={isSaving || !hasNext}
        onClick={() => void editor.save("advance")}
      >
        {saveLabel(translate, editor, "advance")}
        <span aria-hidden="true">›</span>
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

function ReadingFooter({
  translate,
  evaluation,
  updatedBy,
  onEdit,
}: {
  translate: Translator;
  evaluation: Evaluated;
  updatedBy: string | null;
  onEdit: () => void;
}): React.JSX.Element {
  return (
    <footer className="evaluation-sheet-footer">
      <UpdatedNote
        translate={translate}
        updatedAt={evaluation.updatedAt}
        updatedBy={updatedBy}
      />
      <div className="evaluation-actions">
        <button type="button" className="admin-secondary" onClick={onEdit}>
          {translate("evaluations.edit")}
        </button>
      </div>
    </footer>
  );
}

export function EvaluationScores({
  translate,
  evaluation,
  categories,
  updatedBy,
  editor,
  hasNext,
  onReload,
}: {
  translate: Translator;
  evaluation: Evaluated;
  categories: EvaluationCategories | null;
  /** Quién hizo la última edición, si se sabe. */
  updatedBy: string | null;
  editor: RatingsEditor;
  /** Hay alguien después en la lista: si no, Guardar y siguiente no va. */
  hasNext: boolean;
  onReload: () => void;
}): React.JSX.Element {
  return (
    <div className="evaluation-scores">
      <EvaluationRatings
        translate={translate}
        ratings={evaluation.ratings}
        categories={categories}
        editingRows={editor.rows}
        onRatingChange={editor.setRating}
      />
      <SaveFailure translate={translate} editor={editor} onReload={onReload} />
      {editor.rows === null ? (
        <ReadingFooter
          translate={translate}
          evaluation={evaluation}
          updatedBy={updatedBy}
          onEdit={editor.startEditing}
        />
      ) : (
        <footer className="evaluation-sheet-footer">
          <EditingActions
            translate={translate}
            editor={editor}
            hasNext={hasNext}
          />
        </footer>
      )}
    </div>
  );
}
