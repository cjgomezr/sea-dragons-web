import { formatOverallRating } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";

/** El OVR de la ficha (#819), a la derecha de la identidad: la cifra en mono
 * con "OVR" debajo, o la raya de vacío si no hay media de nada (sin evaluar,
 * o sin ninguna categoría). */
export function OverallScore({
  translate,
  overallRating,
}: {
  translate: Translator;
  overallRating: number | null;
}): React.JSX.Element {
  const isEmpty = overallRating === null;
  return (
    <p className="evaluation-overall" data-empty={isEmpty ? "true" : undefined}>
      {isEmpty ? (
        <>
          <span className="evaluation-overall-value" aria-hidden="true">
            —
          </span>
          <span className="visually-hidden">
            {translate("evaluations.table.noOverall")}
          </span>
        </>
      ) : (
        <span className="evaluation-overall-value">
          {formatOverallRating(translate.locale, overallRating)}
        </span>
      )}
      <span
        className="evaluation-overall-caption"
        aria-hidden={isEmpty ? true : undefined}
      >
        {translate("evaluations.table.overall")}
      </span>
    </p>
  );
}
