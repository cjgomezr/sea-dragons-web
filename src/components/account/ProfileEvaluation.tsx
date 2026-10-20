import { EyeSlash } from "@phosphor-icons/react/dist/ssr/EyeSlash";
import { ReadOnlyEvaluation } from "@/components/evaluations/ReadOnlyEvaluation";
import type { ProfileEvaluation as Evaluation } from "@/lib/evaluations/profile-evaluation";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import { SideCard } from "./SideCard";

/** La evaluación en el perfil propio (#324, RF-5 del PRD de E9), en la
 * columna derecha del rediseño (#774, D10). A quien no ve evaluaciones, ni
 * la suya, la tarjeta le explica por qué no hay nota (FR-056): sin el aviso,
 * un jugador no entiende que falte. Lo que no debe ver ni le llega: lo
 * decide el dominio, no esta tarjeta. */
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
        <ReadOnlyEvaluation
          translate={translate}
          evaluation={evaluation.evaluation}
        />
      )}
    </SideCard>
  );
}
