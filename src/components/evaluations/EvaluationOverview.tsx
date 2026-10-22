import { RATING_MAX } from "@/lib/evaluations/member-evaluation";
import {
  type CategoryAverage,
  lowestCategoryAverage,
} from "@/lib/evaluations/evaluation-roster-summary";
import { formatClubShortDay, formatOverallRating } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { ScreenRosterSummary } from "./evaluations-client";

/**
 * El resumen de la plantilla (#819, RF-3 del PRD de E31): lo que enseña el
 * panel lateral sin nadie elegido. Cuántos están evaluados con su barra y el
 * atajo a los pendientes, la media de cada categoría con la más baja en
 * aviso, y quién lleva más tiempo sin revisar. Las medias las calculó el
 * servidor (D5); no está dibujado en el handoff, así que manda su README.
 *
 * En el móvil no sale (D7): el CSS lo esconde con la lista a la vista.
 */

const OVERVIEW_HEADING_ID = "evaluation-overview-heading";
const AVERAGES_HEADING_ID = "evaluation-overview-averages";
const LONGEST_HEADING_ID = "evaluation-overview-longest";
const PERCENT = 100;

export type EvaluatedCount = {
  readonly evaluated: number;
  readonly total: number;
};

function shareOf(value: number, total: number): string {
  return `${total === 0 ? 0 : (value / total) * PERCENT}%`;
}

function Progress({
  translate,
  count,
  onEvaluatePending,
}: {
  translate: Translator;
  count: EvaluatedCount;
  onEvaluatePending: () => void;
}): React.JSX.Element {
  const pending = count.total - count.evaluated;
  return (
    <div className="evaluation-overview-progress">
      <p className="evaluation-overview-count">
        <span className="evaluation-overview-figure">{count.evaluated}</span>{" "}
        {translate("evaluations.overview.progress", { total: count.total })}
      </p>
      <span className="evaluation-overview-bar" aria-hidden="true">
        <span style={{ width: shareOf(count.evaluated, count.total) }} />
      </span>
      {pending === 0 ? (
        <p className="evaluation-overview-done">
          {translate("evaluations.overview.allDone")}
        </p>
      ) : (
        <button
          type="button"
          className="auth-submit"
          onClick={onEvaluatePending}
        >
          {translate("evaluations.overview.evaluatePending", {
            count: pending,
          })}
        </button>
      )}
    </div>
  );
}

function AverageRow({
  translate,
  average,
  isLowest,
}: {
  translate: Translator;
  average: CategoryAverage;
  isLowest: boolean;
}): React.JSX.Element {
  return (
    <li
      className="evaluation-overview-average"
      data-lowest={isLowest ? "true" : undefined}
    >
      <span className="evaluation-overview-average-name">{average.name}</span>
      <span className="evaluation-overview-average-bar" aria-hidden="true">
        <span style={{ width: shareOf(average.average, RATING_MAX) }} />
      </span>
      <span className="evaluation-overview-average-value">
        {formatOverallRating(translate.locale, average.average)}
      </span>
    </li>
  );
}

/** Sin ninguna media (nadie evaluado, o sin categorías activas) no sale. */
function Averages({
  translate,
  summary,
}: {
  translate: Translator;
  summary: ScreenRosterSummary;
}): React.JSX.Element | null {
  const lowest = lowestCategoryAverage(summary.categoryAverages);
  if (lowest === null) {
    return null;
  }
  return (
    <div className="evaluation-overview-section">
      <div className="evaluation-overview-section-head">
        <h3 id={AVERAGES_HEADING_ID} className="evaluation-card-title">
          {translate("evaluations.overview.averages")}
        </h3>
        {summary.averageOverall === null ? null : (
          <p className="evaluation-overview-overall">
            <span className="visually-hidden">
              {translate("evaluations.table.overall")}{" "}
            </span>
            {formatOverallRating(translate.locale, summary.averageOverall)}
          </p>
        )}
      </div>
      <ul
        className="evaluation-overview-averages"
        aria-labelledby={AVERAGES_HEADING_ID}
      >
        {summary.categoryAverages.map((average) => (
          <AverageRow
            key={average.categoryId}
            translate={translate}
            average={average}
            isLowest={average.categoryId === lowest.categoryId}
          />
        ))}
      </ul>
      <p className="evaluation-overview-lowest">
        {translate("evaluations.overview.lowest", { category: lowest.name })}
      </p>
    </div>
  );
}

function LongestUnreviewed({
  translate,
  summary,
  onOpen,
}: {
  translate: Translator;
  summary: ScreenRosterSummary;
  onOpen: (userId: string) => void;
}): React.JSX.Element | null {
  if (summary.longestUnreviewed.length === 0) {
    return null;
  }
  return (
    <div className="evaluation-overview-section">
      <h3 id={LONGEST_HEADING_ID} className="evaluation-card-title">
        {translate("evaluations.overview.longest")}
      </h3>
      <ul
        className="evaluation-overview-longest"
        aria-labelledby={LONGEST_HEADING_ID}
      >
        {summary.longestUnreviewed.map((player) => (
          <li key={player.userId}>
            <button type="button" onClick={() => onOpen(player.userId)}>
              <span className="evaluation-overview-longest-name">
                {player.fullName}
              </span>
              <span className="evaluation-overview-longest-date">
                {formatClubShortDay(
                  translate.locale,
                  new Date(player.updatedAt),
                )}
              </span>
              <span aria-hidden="true">›</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EvaluationOverview({
  translate,
  count,
  summary,
  onEvaluatePending,
  onOpen,
}: {
  translate: Translator;
  count: EvaluatedCount;
  summary: ScreenRosterSummary;
  onEvaluatePending: () => void;
  onOpen: (userId: string) => void;
}): React.JSX.Element {
  return (
    <section
      className="evaluation-overview"
      aria-labelledby={OVERVIEW_HEADING_ID}
    >
      <h2 id={OVERVIEW_HEADING_ID} className="evaluation-card-title">
        {translate("evaluations.overview.title")}
      </h2>
      <Progress
        translate={translate}
        count={count}
        onEvaluatePending={onEvaluatePending}
      />
      <Averages translate={translate} summary={summary} />
      <LongestUnreviewed
        translate={translate}
        summary={summary}
        onOpen={onOpen}
      />
    </section>
  );
}
