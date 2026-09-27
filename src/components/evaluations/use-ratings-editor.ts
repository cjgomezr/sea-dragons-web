import { useRef, useState } from "react";
import type {
  MemberEvaluation,
  RatingChange,
} from "@/lib/evaluations/member-evaluation";
import { type RatingsDraft, draftOf } from "./EvaluationRatings";
import {
  type EvaluationFailure,
  saveMemberEvaluation,
} from "./evaluations-client";

/**
 * Editar las valoraciones de una evaluación (#322): lo ajustado vive aquí
 * hasta que el servidor lo confirma. Un fallo no lo tira, para que reintentar
 * mande lo mismo; sólo recargar la evaluación lo descarta.
 */

type Evaluated = Extract<MemberEvaluation, { status: "evaluated" }>;

export type SaveStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved" }
  | { readonly kind: "failed"; readonly failure: EvaluationFailure };

export type RatingsEditor = {
  readonly draft: RatingsDraft | null;
  readonly status: SaveStatus;
  readonly setDraft: (draft: RatingsDraft) => void;
  readonly startEditing: () => void;
  readonly cancelEditing: () => void;
  readonly save: () => Promise<void>;
};

const IDLE: SaveStatus = { kind: "idle" };

/** Todas las categorías, también las que no se tocaron: la evaluación se
 * guarda entera contra la fecha que se leyó. */
function changesOf(
  evaluation: Evaluated,
  draft: RatingsDraft,
): readonly RatingChange[] {
  return evaluation.ratings.map((entry) => ({
    categoryId: entry.categoryId,
    rating: draft[entry.categoryId] ?? entry.rating,
  }));
}

export function useRatingsEditor(options: {
  readonly evaluation: Evaluated;
  readonly isEditingAtStart: boolean;
  readonly onSaved: (evaluation: MemberEvaluation) => void;
}): RatingsEditor {
  const { evaluation, onSaved } = options;
  const [draft, setDraft] = useState<RatingsDraft | null>(() =>
    options.isEditingAtStart ? draftOf(evaluation.ratings) : null,
  );
  const [status, setStatus] = useState<SaveStatus>(IDLE);
  // El estado tarda un render en deshabilitar el botón; la referencia corta
  // ya el segundo clic de un doble clic.
  const isSaving = useRef(false);

  async function save(): Promise<void> {
    if (draft === null || isSaving.current) {
      return;
    }
    isSaving.current = true;
    setStatus({ kind: "saving" });
    const outcome = await saveMemberEvaluation(evaluation.memberId, {
      expectedUpdatedAt: evaluation.updatedAt,
      ratings: changesOf(evaluation, draft),
    });
    isSaving.current = false;
    if (outcome.kind === "failed") {
      setStatus({ kind: "failed", failure: outcome });
      return;
    }
    setDraft(null);
    setStatus({ kind: "saved" });
    onSaved(outcome.evaluation);
  }

  return {
    draft,
    status,
    setDraft,
    startEditing: () => {
      setDraft(draftOf(evaluation.ratings));
      setStatus(IDLE);
    },
    cancelEditing: () => {
      setDraft(null);
      setStatus(IDLE);
    },
    save,
  };
}
