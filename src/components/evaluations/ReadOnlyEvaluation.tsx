import type { MemberEvaluation } from "@/lib/evaluations/member-evaluation";
import type { Translator } from "@/lib/i18n/translator";
import { ReadOnlyRatings } from "./EvaluationRatings";
import { OverallScore } from "./OverallScore";

/** Una evaluación para leer, fuera de la pantalla de Evaluaciones (#324): el
 * OVR y las categorías, sin editar. Sin evaluación no se inventa un OVR: se
 * dice que no la hay. */
export function ReadOnlyEvaluation({
  translate,
  evaluation,
}: {
  translate: Translator;
  evaluation: MemberEvaluation;
}): React.JSX.Element {
  if (evaluation.status === "not_evaluated") {
    return <p>{translate("evaluations.notEvaluatedYet")}</p>;
  }
  return (
    <div className="evaluation-scores">
      <OverallScore
        translate={translate}
        overallRating={evaluation.overallRating}
      />
      <ReadOnlyRatings translate={translate} ratings={evaluation.ratings} />
    </div>
  );
}
