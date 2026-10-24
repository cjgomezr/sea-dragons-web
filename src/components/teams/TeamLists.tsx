import { useId } from "react";
import { formatOverallRating } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { countTeamCoverage } from "@/lib/teams/position-coverage";
import { TEAM_IDS, type TeamId } from "@/lib/teams/team-ids";
import type { TeamTotals } from "@/lib/teams/team-totals";
import {
  type Destination,
  type RosterPlayer,
  type TeamDraft,
  benchPlayers,
  teamPlayers,
} from "./team-draft";
import { TeamCoverage } from "./TeamCoverage";
import { type ChangeTeams, TeamEditControl } from "./TeamEditor";
import { PLAYER_DRAG_TYPE, TeamPlayerRow } from "./TeamPlayerRow";

/**
 * Las dos tarjetas de equipo del handoff de E28
 * (`docs/design/design_handoff_teams/screenshots/01-desktop-builder.png`,
 * #759), con el lápiz que edita su nombre y su color (#760), y las dos
 * listas del banco: los disponibles y los "Quizás" (#402), con cuántos
 * quedan en cada una (#761). Cada una es una región con su título y admite
 * que le suelten un jugador. La región se llama sólo por el título, sin el
 * número, para que no cambie de nombre al mover a alguien.
 */

export type MovePlayer = (userId: string, destination: Destination) => void;

function DropZone({
  className,
  labelledBy,
  destination,
  onMove,
  canMove,
  style,
  children,
}: {
  readonly className: string;
  readonly labelledBy: string;
  readonly destination: Destination;
  readonly onMove: MovePlayer;
  readonly canMove: (userId: string) => boolean;
  readonly style?: React.CSSProperties;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      className={className}
      style={style}
      aria-labelledby={labelledBy}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const userId = event.dataTransfer.getData(PLAYER_DRAG_TYPE);
        // Se puede soltar cualquier texto; sólo mueve si es de la escuadra.
        if (canMove(userId)) {
          onMove(userId, destination);
        }
      }}
    >
      {children}
    </section>
  );
}

function PlayerList({
  translate,
  draft,
  players,
  team,
  emptyText,
  onMove,
}: {
  readonly translate: Translator;
  readonly draft: TeamDraft;
  readonly players: readonly RosterPlayer[];
  readonly team: TeamId | null;
  readonly emptyText: string;
  readonly onMove: MovePlayer;
}): React.JSX.Element {
  if (players.length === 0) {
    return <p className="team-list-empty">{emptyText}</p>;
  }
  return (
    <ul className="team-list">
      {players.map((player) => (
        <TeamPlayerRow
          key={player.userId}
          translate={translate}
          player={player}
          team={team}
          teams={draft.teams}
          onMove={(destination) => onMove(player.userId, destination)}
        />
      ))}
    </ul>
  );
}

function isInRoster(draft: TeamDraft): (userId: string) => boolean {
  return (userId) => draft.roster.some((player) => player.userId === userId);
}

function ColumnSummary({
  translate,
  totals,
}: {
  readonly translate: Translator;
  readonly totals: TeamTotals;
}): React.JSX.Element {
  const players = translate("teams.column.players", {
    count: totals.playerCount,
  });
  if (totals.averageRating === null) {
    return <p className="team-column-summary">{players}</p>;
  }
  const average = translate("teams.column.average", {
    average: formatOverallRating(translate.locale, totals.averageRating),
  });
  return <p className="team-column-summary">{`${players} · ${average}`}</p>;
}

/** La tarjeta de un equipo (#759): la tira de su color arriba, el muestrario,
 * el nombre con cuántos son y su media, la cobertura y sus jugadores. */
export function TeamCard({
  translate,
  draft,
  team,
  totals,
  onMove,
  onChangeTeams,
}: {
  readonly translate: Translator;
  readonly draft: TeamDraft;
  readonly team: TeamId;
  readonly totals: TeamTotals;
  readonly onMove: MovePlayer;
  readonly onChangeTeams: ChangeTeams;
}): React.JSX.Element {
  const titleId = useId();
  const { name, color } = draft.teams[team];
  const players = teamPlayers(draft, team);
  return (
    <DropZone
      className="team-column"
      labelledBy={titleId}
      destination={team}
      onMove={onMove}
      canMove={isInRoster(draft)}
      style={{ "--team-color": color } as React.CSSProperties}
    >
      <div className="team-column-header">
        <span className="team-column-swatch" aria-hidden="true" />
        <div className="team-column-heading">
          <h2 id={titleId} className="team-column-title">
            {name}
          </h2>
          <ColumnSummary translate={translate} totals={totals} />
        </div>
        <TeamEditControl
          translate={translate}
          team={team}
          teamName={name}
          publishedPlayerCount={draft.isPublished ? draft.saved.length : null}
          onChangeTeams={onChangeTeams}
        />
      </div>
      <TeamCoverage
        translate={translate}
        coverage={countTeamCoverage(players)}
        hasPlayers={players.length > 0}
      />
      <PlayerList
        translate={translate}
        draft={draft}
        players={players}
        team={team}
        emptyText={translate("teams.column.empty")}
        onMove={onMove}
      />
    </DropZone>
  );
}

export function TeamColumns({
  translate,
  draft,
  totals,
  onMove,
  onChangeTeams,
}: {
  readonly translate: Translator;
  readonly draft: TeamDraft;
  readonly totals: Readonly<Record<TeamId, TeamTotals>>;
  readonly onMove: MovePlayer;
  readonly onChangeTeams: ChangeTeams;
}): React.JSX.Element {
  return (
    <div className="team-columns">
      {TEAM_IDS.map((team) => (
        <TeamCard
          key={team}
          translate={translate}
          draft={draft}
          team={team}
          totals={totals[team]}
          onMove={onMove}
          onChangeTeams={onChangeTeams}
        />
      ))}
    </div>
  );
}

function BenchList({
  translate,
  draft,
  origin,
  onMove,
}: {
  readonly translate: Translator;
  readonly draft: TeamDraft;
  readonly origin: "available" | "maybe";
  readonly onMove: MovePlayer;
}): React.JSX.Element {
  const titleId = useId();
  const players = benchPlayers(draft, origin);
  return (
    <DropZone
      className="team-bench-list"
      labelledBy={titleId}
      destination="bench"
      onMove={onMove}
      canMove={isInRoster(draft)}
    >
      <h2 className="team-bench-title">
        <span id={titleId}>{translate(`teams.${origin}.title`)}</span>{" "}
        <span className="team-bench-count">{players.length}</span>
      </h2>
      <PlayerList
        translate={translate}
        draft={draft}
        players={players}
        team={null}
        emptyText={translate(`teams.${origin}.empty`)}
        onMove={onMove}
      />
    </DropZone>
  );
}

export function BenchLists({
  translate,
  draft,
  onMove,
}: {
  readonly translate: Translator;
  readonly draft: TeamDraft;
  readonly onMove: MovePlayer;
}): React.JSX.Element {
  return (
    <div className="team-bench">
      {(["available", "maybe"] as const).map((origin) => (
        <BenchList
          key={origin}
          translate={translate}
          draft={draft}
          origin={origin}
          onMove={onMove}
        />
      ))}
    </div>
  );
}
