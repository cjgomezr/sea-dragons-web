import { useCallback, useRef, useState } from "react";
import type { EvaluationCategories } from "@/lib/evaluations/evaluation-categories";
import type { MemberEvaluation } from "@/lib/evaluations/member-evaluation";
import { calculateOverallRating } from "@/lib/evaluations/overall-rating";
import {
  type EditingRating,
  editingRatings,
} from "@/lib/evaluations/sheet-ratings";
import {
  type EvaluationFailure,
  saveMemberEvaluation,
} from "./evaluations-client";

/**
 * Editar las notas de una evaluación (#322), desde #820 en el panel: lo
 * ajustado vive aquí hasta que el servidor lo confirma. Un fallo no lo tira,
 * para que reintentar mande lo mismo; sólo recargar la evaluación lo
 * descarta.
 *
 * En edición salen las categorías activas del club, con las nuevas en 5, y
 * guardar las manda todas: así la evaluación queda al día en la misma
 * petición (D4 del PRD de E31).
 *
 * La ficha lo usa antes de tener evaluación (cargando, o sin evaluar): sin
 * ella no hay filas, y empezar a editar vale igual, porque lo ajustado se
 * guarda aparte de las notas de las que parte.
 */

type Evaluated = Extract<MemberEvaluation, { status: "evaluated" }>;

/** Lo ajustado y sin guardar, por categoría. Vacío es editar sin haber
 * movido nada todavía. */
type RatingsDraft = Readonly<Record<string, number>>;

const UNTOUCHED: RatingsDraft = {};

/** "Guardar" se queda en la ficha; "Guardar y siguiente" abre al siguiente. */
export type SaveIntent = "stay" | "advance";

export type SaveStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "saving"; readonly intent: SaveIntent }
  | { readonly kind: "failed"; readonly failure: EvaluationFailure };

export type RatingsEditor = {
  /** Las filas con su valor de ahora; `null` mientras no se edita. */
  readonly rows: readonly EditingRating[] | null;
  /** El de la cabecera: en edición, la media de lo ajustado. */
  readonly overallRating: number | null;
  readonly status: SaveStatus;
  readonly setRating: (categoryId: string, rating: number) => void;
  readonly startEditing: () => void;
  readonly cancelEditing: () => void;
  readonly save: (intent: SaveIntent) => Promise<void>;
};

const IDLE: SaveStatus = { kind: "idle" };

/** La que no se ha movido sale con la nota de la que parte. */
function withDraft(
  rows: readonly EditingRating[],
  draft: RatingsDraft,
): readonly EditingRating[] {
  return rows.map((row) => ({
    ...row,
    rating: draft[row.categoryId] ?? row.rating,
  }));
}

/** En edición, la media de lo ajustado con la misma regla que el servidor
 * (D3); fuera, la que ya calculó él. */
function overallOf(
  evaluation: Evaluated | null,
  rows: readonly EditingRating[] | null,
): number | null {
  if (rows !== null) {
    return calculateOverallRating(rows.map((row) => row.rating));
  }
  return evaluation === null ? null : evaluation.overallRating;
}

export function useRatingsEditor(options: {
  /** `null` mientras no hay evaluación que editar. */
  readonly evaluation: Evaluated | null;
  /** Las del club, para editar las activas en su orden. */
  readonly categories: EvaluationCategories | null;
  readonly onSaved: (evaluation: MemberEvaluation, intent: SaveIntent) => void;
}): RatingsEditor {
  const { evaluation, categories, onSaved } = options;
  const [draft, setDraft] = useState<RatingsDraft | null>(null);
  const [status, setStatus] = useState<SaveStatus>(IDLE);
  // El estado tarda un render en deshabilitar los botones; la referencia
  // corta ya el segundo clic de un doble clic.
  const isSaving = useRef(false);
  const rows =
    evaluation === null || draft === null
      ? null
      : withDraft(editingRatings(evaluation.ratings, categories), draft);
  // Estables: la ficha empieza a editar al terminar de leer o de crear.
  const startEditing = useCallback(() => {
    setDraft(UNTOUCHED);
    setStatus(IDLE);
  }, []);
  const cancelEditing = useCallback(() => {
    setDraft(null);
    setStatus(IDLE);
  }, []);

  async function save(intent: SaveIntent): Promise<void> {
    if (evaluation === null || rows === null || isSaving.current) {
      return;
    }
    isSaving.current = true;
    setStatus({ kind: "saving", intent });
    const outcome = await saveMemberEvaluation(evaluation.memberId, {
      expectedUpdatedAt: evaluation.updatedAt,
      ratings: rows.map(({ categoryId, rating }) => ({ categoryId, rating })),
    });
    isSaving.current = false;
    if (outcome.kind === "failed") {
      setStatus({ kind: "failed", failure: outcome });
      return;
    }
    setDraft(null);
    setStatus(IDLE);
    onSaved(outcome.evaluation, intent);
  }

  return {
    rows,
    overallRating: overallOf(evaluation, rows),
    status,
    setRating: (categoryId, rating) =>
      setDraft((current) =>
        current === null ? current : { ...current, [categoryId]: rating },
      ),
    startEditing,
    cancelEditing,
    save,
  };
}
