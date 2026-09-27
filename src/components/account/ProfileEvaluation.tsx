import { ReadOnlyEvaluation } from "@/components/evaluations/ReadOnlyEvaluation";
import type { ProfileEvaluation as Evaluation } from "@/lib/evaluations/profile-evaluation";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

const HEADING_ID = "mi-evaluacion";

/** La evaluación en el perfil propio (#324, RF-5 del PRD de E9). A quien no
 * ve evaluaciones, ni la suya, la sección le explica por qué no hay nota
 * (FR-056): sin el aviso, un jugador no entiende que falte. Lo que no debe
 * ver ni le llega: lo decide el dominio, no esta sección. */
export function ProfileEvaluation({
  locale,
  evaluation,
}: {
  locale: Locale;
  evaluation: Evaluation;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  return (
    <section className="account-evaluation" aria-labelledby={HEADING_ID}>
      <h2 id={HEADING_ID}>{translate("account.evaluation.title")}</h2>
      {evaluation.visibility === "staff_only" ? (
        <p>{translate("account.evaluation.staffOnly")}</p>
      ) : (
        <ReadOnlyEvaluation
          translate={translate}
          evaluation={evaluation.evaluation}
        />
      )}
    </section>
  );
}
