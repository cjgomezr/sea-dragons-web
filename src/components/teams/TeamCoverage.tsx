import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import { HandPalm } from "@phosphor-icons/react/dist/ssr/HandPalm";
import { Lightning } from "@phosphor-icons/react/dist/ssr/Lightning";
import { Shield } from "@phosphor-icons/react/dist/ssr/Shield";
import { Warning } from "@phosphor-icons/react/dist/ssr/Warning";
import { Icon } from "@/components/Icon";
import type { PositionCoverage } from "@/lib/club/club-positions";
import type { Translator } from "@/lib/i18n/translator";
import type { TeamCoverage as Coverage } from "@/lib/teams/position-coverage";

/**
 * Las fichas de cobertura de una tarjeta de equipo (#759, D9 del PRD de
 * E28): POR, DEF y ATA con cuántos tiene. A la vista va la abreviatura; el
 * lector de pantalla oye la palabra entera ("1 portero"). Un equipo con
 * jugadores y sin portero lo dice en la ficha del portero; uno vacío no,
 * porque todavía no le falta nada.
 */

const COVERAGE_GLYPHS: Readonly<Record<PositionCoverage, PhosphorGlyph>> = {
  goalkeeper: HandPalm,
  defender: Shield,
  forward: Lightning,
};

const COVERAGE_ORDER: readonly PositionCoverage[] = [
  "goalkeeper",
  "defender",
  "forward",
];

function CoverageChip({
  translate,
  coverage,
  count,
}: {
  readonly translate: Translator;
  readonly coverage: PositionCoverage;
  readonly count: number;
}): React.JSX.Element {
  return (
    <li className="team-coverage-chip">
      <Icon glyph={COVERAGE_GLYPHS[coverage]} />
      <span aria-hidden="true">
        {`${translate(`teams.coverage.${coverage}`)} ${count}`}
      </span>
      <span className="visually-hidden">
        {translate(`teams.coverage.${coverage}Count`, { count })}
      </span>
    </li>
  );
}

function MissingGoalkeeperChip({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  return (
    <li className="team-coverage-chip team-coverage-missing">
      <Icon glyph={Warning} weight="bold" />
      {translate("teams.coverage.noGoalkeeper")}
    </li>
  );
}

export function TeamCoverage({
  translate,
  coverage,
  hasPlayers,
}: {
  readonly translate: Translator;
  readonly coverage: Coverage;
  readonly hasPlayers: boolean;
}): React.JSX.Element {
  return (
    <ul
      className="team-coverage"
      aria-label={translate("teams.coverage.label")}
    >
      {COVERAGE_ORDER.map((kind) =>
        kind === "goalkeeper" && hasPlayers && coverage.goalkeeper === 0 ? (
          <MissingGoalkeeperChip key={kind} translate={translate} />
        ) : (
          <CoverageChip
            key={kind}
            translate={translate}
            coverage={kind}
            count={coverage[kind]}
          />
        ),
      )}
    </ul>
  );
}
