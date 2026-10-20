import { ArrowsLeftRight } from "@phosphor-icons/react/dist/ssr/ArrowsLeftRight";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { Lightbulb } from "@phosphor-icons/react/dist/ssr/Lightbulb";
import { Warning } from "@phosphor-icons/react/dist/ssr/Warning";
import { useId } from "react";
import { Icon } from "@/components/Icon";
import { formatOverallRating } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { TeamLabel, TeamLabels } from "@/lib/teams/team-ids";
import type { SplitTotals } from "@/lib/teams/team-totals";
import type { DraftSuggestion } from "./team-draft";

/**
 * La barra de totales y la sugerencia de intercambio (#402, FR-045 y
 * FR-047), con la forma del handoff de E28 (#758): la suma de cada equipo a
 * su lado, en medio si están parejos, y debajo una barra partida por suma en
 * el color de cada equipo. Lo que dice la barra va escrito encima.
 */

/** Hasta un punto de diferencia los equipos cuentan como parejos (RF-4). */
const EVEN_GAP_MAX = 1;

/** Sin puntos en ningún equipo, la barra se parte a medias. */
const EMPTY_SHARE = 1;

function barShares(totals: SplitTotals): readonly [number, number] {
  const { a, b } = totals;
  return a.combinedRating + b.combinedRating === 0
    ? [EMPTY_SHARE, EMPTY_SHARE]
    : [a.combinedRating, b.combinedRating];
}

function GapStatus({
  translate,
  difference,
}: {
  readonly translate: Translator;
  readonly difference: number;
}): React.JSX.Element {
  if (difference <= EVEN_GAP_MAX) {
    return (
      <span className="team-totals-gap team-totals-even">
        <Icon glyph={CheckCircle} />
        {translate("teams.totals.even")}
      </span>
    );
  }
  return (
    <span className="team-totals-gap team-totals-apart">
      <Icon glyph={Warning} />
      {translate("teams.totals.apart", {
        difference: formatOverallRating(translate.locale, difference),
      })}
    </span>
  );
}

function BarSegment({
  team,
  share,
}: {
  readonly team: TeamLabel;
  readonly share: number;
}): React.JSX.Element {
  return <span style={{ flexGrow: share, backgroundColor: team.color }} />;
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
  const [shareA, shareB] = barShares(totals);
  return (
    <div
      className="team-totals"
      role="group"
      aria-label={translate("teams.totals.label")}
    >
      <div className="team-totals-text">
        <span className="team-totals-team">
          <span className="team-totals-name">{teams.a.name}</span>{" "}
          <span className="team-totals-points">
            {points(totals.a.combinedRating)}
          </span>
        </span>{" "}
        <GapStatus translate={translate} difference={totals.ratingDifference} />{" "}
        <span className="team-totals-team">
          <span className="team-totals-points">
            {points(totals.b.combinedRating)}
          </span>{" "}
          <span className="team-totals-name">{teams.b.name}</span>
        </span>
      </div>
      <div className="team-totals-bar" aria-hidden="true">
        <BarSegment team={teams.a} share={shareA} />
        <BarSegment team={teams.b} share={shareB} />
      </div>
    </div>
  );
}

/** La sugerencia de intercambio con la forma del handoff (#761): la bombilla,
 * "Sugerencia:" en negrita, a quién cambiar por quién con sus equipos, y el
 * botón que lo hace. La región se llama sólo "Sugerencia", sin los dos
 * puntos. */
export function SwapSuggestion({
  translate,
  teams,
  suggestion,
  onApply,
}: {
  readonly translate: Translator;
  readonly teams: TeamLabels;
  readonly suggestion: DraftSuggestion;
  readonly onApply: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const names = {
    first: suggestion.fromA.fullName,
    firstTeam: teams.a.name,
    second: suggestion.fromB.fullName,
    secondTeam: teams.b.name,
  };
  return (
    <section className="team-suggestion" aria-labelledby={titleId}>
      <span className="team-suggestion-icon">
        <Icon glyph={Lightbulb} />
      </span>
      <p className="team-suggestion-text">
        <strong>
          <span id={titleId}>{translate("teams.suggestion.title")}</span>:
        </strong>{" "}
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
      <button
        type="button"
        className="admin-secondary team-suggestion-apply"
        onClick={onApply}
      >
        <Icon glyph={ArrowsLeftRight} />
        {translate("teams.suggestion.apply")}
      </button>
    </section>
  );
}
