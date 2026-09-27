import { RATING_MAX } from "@/lib/evaluations/member-evaluation";
import { formatOverallRating } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";

/** El OVR grande del mockup (#322), o "sin datos" si la evaluación no tiene
 * ninguna categoría: no hay media de nada. */
export function OverallScore({
  translate,
  overallRating,
}: {
  translate: Translator;
  overallRating: number | null;
}): React.JSX.Element {
  return (
    <div className="card evaluation-overall">
      <h3 className="evaluation-card-title">
        {translate("evaluations.overall.title")}
      </h3>
      {overallRating === null ? (
        <p className="evaluation-overall-empty">
          {translate("evaluations.overall.noData")}
        </p>
      ) : (
        <>
          <p className="evaluation-overall-value">
            {formatOverallRating(translate.locale, overallRating)}
          </p>
          <p className="evaluation-overall-scale">
            {translate("evaluations.overall.outOf", { max: RATING_MAX })}
          </p>
        </>
      )}
    </div>
  );
}
