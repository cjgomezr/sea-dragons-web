"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ReadOnlyEvaluation } from "@/components/evaluations/ReadOnlyEvaluation";
import {
  type EvaluationLoad,
  describeEvaluationFailure,
  loadMemberEvaluation,
} from "@/components/evaluations/evaluations-client";
import { memberEvaluationHref } from "@/lib/evaluations/member-evaluation-href";
import type { Translator } from "@/lib/i18n/translator";

/**
 * La evaluación en la ficha de un miembro (#324, RF-5 del PRD de E9): el OVR
 * y las categorías, para leer. Editarla es cosa de Evaluaciones, y el enlace
 * lleva allí con la ficha de esta persona abierta.
 *
 * La ficha es sólo del Admin, que ve evaluaciones. Si deja de verlas con la
 * pantalla abierta, el 403 del endpoint lo dice aquí sin tumbar el resto.
 */

const HEADING_ID = "ficha-evaluacion";

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
      return <p>{translate("memberRecord.evaluation.loading")}</p>;
    case "failed":
      return (
        <p className="auth-error" role="alert">
          {describeEvaluationFailure(translate, state)}
        </p>
      );
    case "loaded":
      return (
        <ReadOnlyEvaluation
          translate={translate}
          evaluation={state.evaluation}
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
    <section className="admin-section" aria-labelledby={HEADING_ID}>
      <h2 id={HEADING_ID}>{translate("memberRecord.evaluation.title")}</h2>
      <EvaluationContent translate={translate} state={state} />
      <Link href={memberEvaluationHref(userId)}>
        {translate("memberRecord.evaluation.open")}
      </Link>
    </section>
  );
}
