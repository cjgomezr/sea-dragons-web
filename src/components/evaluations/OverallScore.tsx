import { formatOverallRating } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";

/** El OVR de la ficha (#819), a la derecha de la identidad: la cifra en mono
 * o la raya de vacío si no hay media de nada (sin evaluar, o sin ninguna
 * categoría). */
export function OverallScore({
  translate,
  overallRating,
}: {
  translate: Translator;
  overallRating: number | null;
}): React.JSX.Element {
  if (overallRating === null) {
    return (
      <p className="evaluation-overall" data-empty="true">
        <span aria-hidden="true">—</span>
        <span className="visually-hidden">
          {translate("evaluations.table.noOverall")}
        </span>
      </p>
    );
  }
  return (
    <p className="evaluation-overall">
      <span className="visually-hidden">
        {translate("evaluations.table.overall")}{" "}
      </span>
      {formatOverallRating(translate.locale, overallRating)}
    </p>
  );
}
