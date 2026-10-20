import { EyeSlash } from "@phosphor-icons/react/dist/ssr/EyeSlash";
import { EvaluationSummary } from "@/components/evaluations/EvaluationSummary";
import type { ProfileEvaluation as Evaluation } from "@/lib/evaluations/profile-evaluation";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { SideCard } from "./SideCard";

function VisibleEvaluation({
  translate,
  evaluation,
}: {
  translate: Translator;
  evaluation: Extract<Evaluation, { visibility: "visible" }>["evaluation"];
}): React.JSX.Element {
  return evaluation.status === "not_evaluated" ? (
    <p className="profile-side-card-empty">
      {translate("memberRecord.evaluation.notEvaluated")}
    </p>
  ) : (
    <EvaluationSummary translate={translate} evaluation={evaluation} />
  );
}

/** La evaluación en el perfil propio (#324, RF-5 del PRD de E9), en la
 * columna derecha del rediseño (#774, D10). A quien no ve evaluaciones, ni
 * la suya, la tarjeta le explica por qué no hay nota (FR-056): sin el aviso,
 * un jugador no entiende que falte. Lo que no debe ver ni le llega: lo
 * decide el dominio, no esta tarjeta. A quien sí la ve, la tarjeta le da el
 * resumen de la ficha con todas sus categorías: la evaluación de pantalla
 * entera no cabe en la columna. */
export function ProfileEvaluation({
  locale,
  evaluation,
}: {
  locale: Locale;
  evaluation: Evaluation;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  return (
    <SideCard
      headingId="mi-evaluacion"
      title={translate("account.evaluation.title")}
    >
      {evaluation.visibility === "staff_only" ? (
        <p className="profile-side-card-notice">
          <EyeSlash aria-hidden="true" focusable="false" weight="regular" />
          {translate("account.evaluation.staffOnly")}
        </p>
      ) : (
        <VisibleEvaluation
          translate={translate}
          evaluation={evaluation.evaluation}
        />
      )}
    </SideCard>
  );
}
