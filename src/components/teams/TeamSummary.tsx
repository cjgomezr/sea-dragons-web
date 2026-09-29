import { useId } from "react";
import { formatOverallRating } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { TeamLabels } from "@/lib/teams/team-ids";
import type { SplitTotals } from "@/lib/teams/team-totals";
import type { DraftSuggestion } from "./team-draft";

/**
 * La barra de totales y la sugerencia de intercambio del mockup (#402,
 * FR-045 y FR-047). La barra reparte su ancho según el puntaje combinado de
 * cada equipo, con sus colores; lo que dice va en texto al lado.
 */

const FULL_WIDTH_PERCENT = 100;
const EVEN_SHARE_PERCENT = 50;

/** Qué parte de la barra es del primer equipo. Sin puntos, mitad y mitad. */
function shareOfFirstTeam(totals: SplitTotals): number {
  const combined = totals.a.combinedRating + totals.b.combinedRating;
  return combined === 0
    ? EVEN_SHARE_PERCENT
    : (totals.a.combinedRating / combined) * FULL_WIDTH_PERCENT;
}

export function TotalsBar({
  translate,
  teams,
  totals,
}: {
  readonly translate: Translator;
  readonly teams: TeamLabels;
  readonly totals: SplitTotals;
}): React.JSX.Element {
  const points = (value: number) =>
    formatOverallRating(translate.locale, value);
  const share = shareOfFirstTeam(totals);
  return (
    <div
      className="team-totals"
      role="group"
      aria-label={translate("teams.totals.label")}
    >
      <div className="team-totals-text">
        <span>
          {translate("teams.totals.team", {
            team: teams.a.name,
            points: points(totals.a.combinedRating),
          })}
        </span>
        <span className="team-totals-difference">
          {translate("teams.totals.difference", {
            difference: points(totals.ratingDifference),
          })}
        </span>
        <span>
          {translate("teams.totals.team", {
            team: teams.b.name,
            points: points(totals.b.combinedRating),
          })}
        </span>
      </div>
      <div className="team-totals-bar" aria-hidden="true">
        <span style={{ width: `${share}%`, backgroundColor: teams.a.color }} />
        <span
          style={{
            width: `${FULL_WIDTH_PERCENT - share}%`,
            backgroundColor: teams.b.color,
          }}
        />
      </div>
    </div>
  );
}

export function SwapSuggestion({
  translate,
  suggestion,
  onApply,
}: {
  readonly translate: Translator;
  readonly suggestion: DraftSuggestion;
  readonly onApply: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const names = {
    first: suggestion.fromA.fullName,
    second: suggestion.fromB.fullName,
  };
  return (
    <section className="team-suggestion" aria-labelledby={titleId}>
      <p className="team-suggestion-text">
        <strong id={titleId}>{translate("teams.suggestion.title")}</strong>{" "}
        {suggestion.improvement === "coverage"
          ? translate("teams.suggestion.coverage", names)
          : translate("teams.suggestion.rating", {
              ...names,
              difference: formatOverallRating(
                translate.locale,
                suggestion.ratingDifferenceAfter,
              ),
            })}
      </p>
      <button type="button" className="admin-secondary" onClick={onApply}>
        {translate("teams.suggestion.apply")}
      </button>
    </section>
  );
}
