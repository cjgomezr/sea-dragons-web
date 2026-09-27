import { useRef, useState } from "react";
import type { MemberEvaluation } from "@/lib/evaluations/member-evaluation";
import type { Translator } from "@/lib/i18n/translator";
import {
  type EvaluationFailure,
  describeEvaluationFailure,
  refreshMemberEvaluation,
} from "./evaluations-client";

/**
 * Poner al día una evaluación (#323, FR-053, AC-054): si el club cambió sus
 * categorías después de hacerla, la ficha lo dice y ofrece llevarla al
 * conjunto actual. Es una acción aparte y no un efecto de guardar (AC-035).
 *
 * Si está al día lo decide el servidor (`isCurrent`): la pantalla no vuelve a
 * contar categorías.
 */

type Evaluated = Extract<MemberEvaluation, { status: "evaluated" }>;

type RefreshStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "refreshing" }
  | { readonly kind: "refreshed" }
  | { readonly kind: "failed"; readonly failure: EvaluationFailure };

export function EvaluationRefreshOffer({
  translate,
  evaluation,
  onRefreshed,
}: {
  translate: Translator;
  evaluation: Evaluated;
  onRefreshed: (evaluation: MemberEvaluation) => void;
}): React.JSX.Element | null {
  const [status, setStatus] = useState<RefreshStatus>({ kind: "idle" });
  // Como al guardar: el estado tarda un render en deshabilitar el botón.
  const isRefreshing = useRef(false);

  async function refresh(): Promise<void> {
    if (isRefreshing.current) {
      return;
    }
    isRefreshing.current = true;
    setStatus({ kind: "refreshing" });
    const outcome = await refreshMemberEvaluation(evaluation.memberId);
    isRefreshing.current = false;
    if (outcome.kind === "failed") {
      setStatus({ kind: "failed", failure: outcome });
      return;
    }
    setStatus({ kind: "refreshed" });
    onRefreshed(outcome.evaluation);
  }

  if (evaluation.isCurrent) {
    return status.kind === "refreshed" ? (
      <p className="admin-notice" role="status">
        {translate("evaluations.refresh.done")}
      </p>
    ) : null;
  }
  const isBusy = status.kind === "refreshing";
  return (
    <div className="evaluation-refresh">
      <p className="auth-note">{translate("evaluations.refresh.hint")}</p>
      {status.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {describeEvaluationFailure(translate, status.failure)}
        </p>
      ) : null}
      <button
        type="button"
        className="admin-secondary"
        disabled={isBusy}
        onClick={() => void refresh()}
      >
        {translate(
          isBusy ? "evaluations.refresh.running" : "evaluations.refresh.action",
        )}
      </button>
    </div>
  );
}
