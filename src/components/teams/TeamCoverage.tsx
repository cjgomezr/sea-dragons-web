import { Warning } from "@phosphor-icons/react/dist/ssr/Warning";
import { Icon } from "@/components/Icon";
import {
  type PositionChoice,
  positionName,
  positionShortName,
} from "@/lib/club/club-positions";
import type { Translator } from "@/lib/i18n/translator";
import {
  type PositionTally,
  tallyPosition,
} from "@/lib/teams/position-coverage";
import type { SquadPlayer } from "@/lib/teams/squad";

/**
 * Las fichas de cobertura de una tarjeta de equipo (#888, RF-5 del PRD de
 * E34): una por posición con mínimo, en el orden del club, con su
 * abreviatura y cuántos tiene. Al lector va el nombre entero ("Goalkeeper:
 * 1"). La ficha de un mínimo que el equipo no cumple sale en aviso y dice
 * cuántos faltan. Sin iconos por posición (D6): sólo el aviso lleva el suyo.
 */

type PositionedPlayer = Pick<SquadPlayer, "positionId">;

function CountChip({
  translate,
  position,
  count,
}: {
  readonly translate: Translator;
  readonly position: PositionChoice;
  readonly count: number;
}): React.JSX.Element {
  return (
    <li className="team-coverage-chip">
      <span aria-hidden="true">
        {`${positionShortName(position, translate.locale)} ${count}`}
      </span>
      <span className="visually-hidden">
        {translate("teams.coverage.position", {
          position: positionName(position.names, translate.locale),
          count,
        })}
      </span>
    </li>
  );
}

function MissingChip({
  translate,
  position,
  missingCount,
}: {
  readonly translate: Translator;
  readonly position: PositionChoice;
  readonly missingCount: number;
}): React.JSX.Element {
  return (
    <li className="team-coverage-chip team-coverage-missing">
      <Icon glyph={Warning} weight="bold" />
      <span aria-hidden="true">
        {translate("teams.coverage.short", {
          count: missingCount,
          shortName: positionShortName(position, translate.locale),
        })}
      </span>
      <span className="visually-hidden">
        {translate("teams.coverage.missing", {
          count: missingCount,
          position: positionName(position.names, translate.locale),
        })}
      </span>
    </li>
  );
}

function PositionChip({
  translate,
  position,
  tally,
}: {
  readonly translate: Translator;
  readonly position: PositionChoice;
  readonly tally: PositionTally;
}): React.JSX.Element {
  return tally.missingCount > 0 ? (
    <MissingChip
      translate={translate}
      position={position}
      missingCount={tally.missingCount}
    />
  ) : (
    <CountChip translate={translate} position={position} count={tally.count} />
  );
}

export function TeamCoverage({
  translate,
  positions,
  team,
  squad,
}: {
  readonly translate: Translator;
  /** Las posiciones con mínimo del club, en su orden. */
  readonly positions: readonly PositionChoice[];
  readonly team: readonly PositionedPlayer[];
  /** Todos los que se pueden repartir: deciden qué mínimo se puede cumplir. */
  readonly squad: readonly PositionedPlayer[];
}): React.JSX.Element | null {
  if (positions.length === 0) {
    return null;
  }
  return (
    <ul
      className="team-coverage"
      aria-label={translate("teams.coverage.label")}
    >
      {positions.map((position) => (
        <PositionChip
          key={position.id}
          translate={translate}
          position={position}
          tally={tallyPosition(team, squad, {
            positionId: position.id,
            minPerTeam: position.minPerTeam,
          })}
        />
      ))}
    </ul>
  );
}
