"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SideCard } from "@/components/account/SideCard";
import {
  type EvaluationLoad,
  describeEvaluationFailure,
  loadMemberEvaluation,
} from "@/components/evaluations/evaluations-client";
import { EvaluationSummary } from "@/components/evaluations/EvaluationSummary";
import { memberEvaluationHref } from "@/lib/evaluations/member-evaluation-href";
import type { Translator } from "@/lib/i18n/translator";

/**
 * La evaluación en la ficha de un miembro (#324, RF-5 del PRD de E9), en la
 * columna derecha del rediseño (#774, D10): la nota global con su fecha y
 * hasta cuatro categorías con su barra. Editarla es cosa de Evaluaciones, y
 * "Abrir" lleva allí con la ficha de esta persona abierta.
 *
 * Sólo la pinta la vista del Admin, que ve evaluaciones; Committee y Coach no
 * la reciben (D1, D3). Si deja de verlas con la pantalla abierta, el 403 del
 * endpoint lo dice aquí sin tumbar el resto.
 */

const HEADING_ID = "ficha-evaluacion";

/** Las que caben en la tarjeta; el resto está en la evaluación entera. */
const SHOWN_CATEGORIES = 4;

type EvaluationState = { readonly kind: "loading" } | EvaluationLoad;

function EvaluationContent({
  translate,
  state,
}: {
  translate: Translator;
  state: EvaluationState;
}): React.JSX.Element {
  switch (state.kind) {
    case "loading":
      return (
        <p className="profile-side-card-empty">
          {translate("memberRecord.evaluation.loading")}
        </p>
      );
    case "failed":
      return (
        <p className="auth-error" role="alert">
          {describeEvaluationFailure(translate, state)}
        </p>
      );
    case "loaded":
      return state.evaluation.status === "not_evaluated" ? (
        <p className="profile-side-card-empty">
          {translate("memberRecord.evaluation.notEvaluated")}
        </p>
      ) : (
        <EvaluationSummary
          translate={translate}
          evaluation={state.evaluation}
          shownCategories={SHOWN_CATEGORIES}
        />
      );
  }
}

export function MemberRecordEvaluation({
  translate,
  userId,
}: {
  translate: Translator;
  userId: string;
}): React.JSX.Element {
  const [state, setState] = useState<EvaluationState>({ kind: "loading" });

  useEffect(() => {
    let isCurrent = true;
    void loadMemberEvaluation(userId).then((outcome) => {
      if (isCurrent) {
        setState(outcome);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [userId]);

  return (
    <SideCard
      headingId={HEADING_ID}
      title={translate("memberRecord.evaluation.title")}
      action={
        <Link
          href={memberEvaluationHref(userId)}
          className="profile-side-card-link"
          aria-label={translate("memberRecord.evaluation.openLabel")}
        >
          {translate("memberRecord.evaluation.open")}
        </Link>
      }
    >
      <EvaluationContent translate={translate} state={state} />
    </SideCard>
  );
}
