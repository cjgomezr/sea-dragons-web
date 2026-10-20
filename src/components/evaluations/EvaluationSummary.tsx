import {
  type EvaluationRating,
  type MemberEvaluation,
  RATING_MAX,
} from "@/lib/evaluations/member-evaluation";
import { formatClubShortDay, formatOverallRating } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";

/**
 * La evaluación resumida para una tarjeta de la columna derecha (#774, D10):
 * la nota global con su fecha y cada categoría con su barra. La usan la ficha
 * del Admin, que corta en unas pocas porque "Abrir" lleva a la entera, y el
 * perfil propio, que las enseña todas porque el socio no tiene otro sitio
 * donde verlas.
 */

export type EvaluatedMember = Extract<
  MemberEvaluation,
  { status: "evaluated" }
>;

function CategoryBar({
  translate,
  entry,
}: {
  translate: Translator;
  entry: EvaluationRating;
}): React.JSX.Element {
  const share = (entry.rating / RATING_MAX) * 100;
  return (
    <li>
      <span className="profile-evaluation-name">{entry.name}</span>
      <span className="profile-evaluation-bar" aria-hidden="true">
        <span style={{ width: `${share}%` }} />
      </span>
      <span className="profile-evaluation-value">
        {formatOverallRating(translate.locale, entry.rating)}
      </span>
    </li>
  );
}

export function EvaluationSummary({
  translate,
  evaluation,
  shownCategories = evaluation.ratings.length,
}: {
  translate: Translator;
  evaluation: EvaluatedMember;
  /** Cuántas categorías caben; sin él, todas. */
  shownCategories?: number;
}): React.JSX.Element {
  return (
    <>
      <p className="profile-evaluation-overall">
        <span className="profile-evaluation-score">
          {evaluation.overallRating === null
            ? translate("evaluations.overall.noData")
            : formatOverallRating(translate.locale, evaluation.overallRating)}
        </span>
        <span>
          {translate("memberRecord.evaluation.overall", {
            date: formatClubShortDay(
              translate.locale,
              new Date(evaluation.updatedAt),
            ),
          })}
        </span>
      </p>
      <ul
        className="profile-evaluation-categories"
        aria-label={translate("memberRecord.evaluation.categories")}
      >
        {evaluation.ratings.slice(0, shownCategories).map((entry) => (
          <CategoryBar
            key={entry.categoryId}
            translate={translate}
            entry={entry}
          />
        ))}
      </ul>
    </>
  );
}
