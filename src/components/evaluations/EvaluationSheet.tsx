"use client";

import { useEffect, useRef, useState } from "react";
import type { EvaluationCategories } from "@/lib/evaluations/evaluation-categories";
import type { MemberEvaluation } from "@/lib/evaluations/member-evaluation";
import type { Translator } from "@/lib/i18n/translator";
import { EvaluationScores } from "./EvaluationScores";
import {
  EvaluationSheetFrame,
  type SheetContext,
} from "./EvaluationSheetFrame";
import {
  type EvaluationFailure,
  type EvaluationLoad,
  type ScreenRosterEntry,
  createMemberEvaluation,
  describeEvaluationFailure,
  isStaleEvaluation,
  loadMemberEvaluation,
} from "./evaluations-client";
import { type SaveIntent, useRatingsEditor } from "./use-ratings-editor";

/**
 * La ficha de un miembro en Evaluaciones (#322): su evaluación, o la oferta
 * de crearla si no la tiene. Desde #819 (RF-3 del PRD de E31) es el panel
 * lateral, y desde #820 se editan ahí las notas, con el OVR en vivo y
 * Guardar y siguiente para evaluar a varios seguidos sin volver a la lista.
 *
 * La pantalla la monta con `key` por miembro: cambiar de miembro empieza de
 * cero, sin arrastrar lo ajustado de otro.
 */

type Evaluated = Extract<MemberEvaluation, { status: "evaluated" }>;

type SheetState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: EvaluationFailure }
  | { readonly kind: "ready"; readonly evaluation: MemberEvaluation };

type CreationStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "creating" }
  | { readonly kind: "failed"; readonly failure: EvaluationFailure };

/** Lo que deja la primera lectura: la evaluación, o el fallo al leerla o al
 * crearla. */
type SheetOpening =
  | { readonly kind: "read"; readonly load: EvaluationLoad }
  | {
      readonly kind: "creation_failed";
      readonly memberId: string;
      readonly failure: EvaluationFailure;
    };

/** Abrir en edición a quien no tiene evaluación es lo mismo que pulsar
 * Empezar evaluación: se crea con todo en 5 y se abre para ajustar. */
async function openEvaluation(
  memberId: string,
  isEditingOnOpen: boolean,
): Promise<SheetOpening> {
  const load = await loadMemberEvaluation(memberId);
  if (
    !isEditingOnOpen ||
    load.kind === "failed" ||
    load.evaluation.status === "evaluated"
  ) {
    return { kind: "read", load };
  }
  const created = await createMemberEvaluation(memberId);
  return created.kind === "failed"
    ? { kind: "creation_failed", memberId, failure: created }
    : { kind: "read", load: created };
}

function LoadFailure({
  translate,
  failure,
  onRetry,
}: {
  translate: Translator;
  failure: EvaluationFailure;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="admin-load-failure">
      <p className="auth-error" role="alert">
        {describeEvaluationFailure(translate, failure)}
      </p>
      <button type="button" className="auth-submit" onClick={onRetry}>
        {translate("evaluations.retry")}
      </button>
    </div>
  );
}

/** Si otro la creó entretanto, crear otra vez fallaría siempre: lo que se
 * ofrece es recargar. */
function CreationAction({
  translate,
  status,
  onCreate,
  onReload,
}: {
  translate: Translator;
  status: CreationStatus;
  onCreate: () => void;
  onReload: () => void;
}): React.JSX.Element {
  if (status.kind === "failed" && isStaleEvaluation(status.failure)) {
    return (
      <button type="button" className="admin-secondary" onClick={onReload}>
        {translate("evaluations.reload")}
      </button>
    );
  }
  const isCreating = status.kind === "creating";
  return (
    <button
      type="button"
      className="auth-submit"
      disabled={isCreating}
      onClick={onCreate}
    >
      {translate(isCreating ? "evaluations.creating" : "evaluations.create")}
    </button>
  );
}

function NotEvaluated({
  translate,
  fullName,
  status,
  onCreate,
  onReload,
}: {
  translate: Translator;
  fullName: string;
  status: CreationStatus;
  onCreate: () => void;
  onReload: () => void;
}): React.JSX.Element {
  return (
    <div className="evaluation-missing">
      <p className="evaluation-missing-title">
        {translate("evaluations.notEvaluated.title", { name: fullName })}
      </p>
      <p className="evaluation-missing-hint">
        {translate("evaluations.notEvaluated.hint")}
      </p>
      {status.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {describeEvaluationFailure(translate, status.failure)}
        </p>
      ) : null}
      <CreationAction
        translate={translate}
        status={status}
        onCreate={onCreate}
        onReload={onReload}
      />
    </div>
  );
}

/** Quién la editó por última vez lo trae la lista, no la ficha. La pantalla
 * pone la fila al día con cada lectura y cada guardado, y lo deja en `null`
 * si la versión cambió. */
function updatedByOf(member: ScreenRosterEntry): string | null {
  return member.status === "evaluated" ? member.updatedBy : null;
}

function evaluatedOf(state: SheetState): Evaluated | null {
  return state.kind === "ready" && state.evaluation.status === "evaluated"
    ? state.evaluation
    : null;
}

export function EvaluationSheet({
  context,
  categories,
  isEditingOnOpen,
  onEvaluationChange,
  onSaved,
}: {
  context: SheetContext;
  /** Las del club, para las notas en su orden; `null` si no se pudieron
   * leer. */
  categories: EvaluationCategories | null;
  /** Se abre ya en edición: Guardar y siguiente, o Evaluar a los
   * pendientes. */
  isEditingOnOpen: boolean;
  /** Lo que el servidor confirmó o devolvió al leer, para que la lista ponga
   * el OVR al día. */
  onEvaluationChange: (evaluation: MemberEvaluation) => void;
  /** Se acaba de guardar: a quién abrir después si se pidió Guardar y
   * siguiente, o `null`. */
  onSaved: (nextId: string | null) => void;
}): React.JSX.Element {
  const { translate, member } = context;
  const memberId = member.userId;
  const [state, setState] = useState<SheetState>({ kind: "loading" });
  const [creation, setCreation] = useState<CreationStatus>({ kind: "idle" });
  // Recargar cuenta como una lectura más, aunque sea del mismo miembro, y
  // vuelve a la lectura aunque se abriera en edición.
  const [reloads, setReloads] = useState(0);
  // La edición vive aquí y no en las notas porque el OVR de la cabecera y el
  // borde de la caja la siguen.
  const editor = useRatingsEditor({
    evaluation: evaluatedOf(state),
    categories,
    onSaved: confirmSaved,
  });
  const { startEditing } = editor;
  // La lista se pone al día también con lo que se lee, no sólo con lo que se
  // guarda: tras un 409 la ficha y la lista tienen que decir el mismo OVR. Por
  // referencia, para que un callback nuevo en cada render no relance la
  // lectura.
  const notifyChange = useRef(onEvaluationChange);
  useEffect(() => {
    notifyChange.current = onEvaluationChange;
  }, [onEvaluationChange]);

  useEffect(() => {
    let isCurrent = true;
    const startsEditing = isEditingOnOpen && reloads === 0;
    void openEvaluation(memberId, startsEditing).then((opening) => {
      if (!isCurrent) {
        return;
      }
      if (opening.kind === "creation_failed") {
        setState({
          kind: "ready",
          evaluation: { status: "not_evaluated", memberId: opening.memberId },
        });
        setCreation({ kind: "failed", failure: opening.failure });
        return;
      }
      const { load } = opening;
      if (load.kind === "failed") {
        setState({ kind: "failed", failure: load });
        return;
      }
      setState({ kind: "ready", evaluation: load.evaluation });
      if (startsEditing) {
        startEditing();
      }
      notifyChange.current(load.evaluation);
    });
    return () => {
      isCurrent = false;
    };
  }, [memberId, reloads, isEditingOnOpen, startEditing]);

  function reload(): void {
    setState({ kind: "loading" });
    setCreation({ kind: "idle" });
    editor.cancelEditing();
    setReloads((count) => count + 1);
  }

  function showConfirmed(evaluation: MemberEvaluation): void {
    setState({ kind: "ready", evaluation });
    onEvaluationChange(evaluation);
  }

  /** Recién creada se abre ya editando: es a lo que se venía. */
  async function create(): Promise<void> {
    setCreation({ kind: "creating" });
    const outcome = await createMemberEvaluation(memberId);
    if (outcome.kind === "failed") {
      setCreation({ kind: "failed", failure: outcome });
      return;
    }
    setCreation({ kind: "idle" });
    showConfirmed(outcome.evaluation);
    startEditing();
  }

  function confirmSaved(
    evaluation: MemberEvaluation,
    intent: SaveIntent,
  ): void {
    showConfirmed(evaluation);
    onSaved(intent === "advance" ? context.position.nextId : null);
  }

  const evaluated = evaluatedOf(state);
  return (
    <EvaluationSheetFrame
      context={context}
      overallRating={editor.overallRating}
      isEditing={editor.rows !== null}
    >
      {state.kind === "loading" ? (
        <p className="admin-empty">{translate("evaluations.sheet.loading")}</p>
      ) : null}
      {state.kind === "failed" ? (
        <LoadFailure
          translate={translate}
          failure={state.failure}
          onRetry={reload}
        />
      ) : null}
      {state.kind === "ready" && evaluated === null ? (
        <NotEvaluated
          translate={translate}
          fullName={member.fullName}
          status={creation}
          onCreate={() => void create()}
          onReload={reload}
        />
      ) : null}
      {evaluated === null ? null : (
        <EvaluationScores
          translate={translate}
          evaluation={evaluated}
          categories={categories}
          updatedBy={updatedByOf(member)}
          editor={editor}
          hasNext={context.position.nextId !== null}
          onReload={reload}
        />
      )}
    </EvaluationSheetFrame>
  );
}
