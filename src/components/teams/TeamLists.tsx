import { useId } from "react";
import { formatOverallRating } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { TEAM_IDS, type TeamId } from "@/lib/teams/team-ids";
import type { TeamTotals } from "@/lib/teams/team-totals";
import {
  type Destination,
  type RosterPlayer,
  type TeamDraft,
  benchPlayers,
  teamPlayers,
} from "./team-draft";
import { PLAYER_DRAG_TYPE, TeamPlayerRow } from "./TeamPlayerRow";

/**
 * Las dos columnas del mockup (`docs/mockups/team-light.png`) y las dos
 * listas que el mockup no dibuja: los disponibles y los "Quizás" (#402).
 * Cada una es una región con su título y admite que le suelten un jugador.
 */

export type MovePlayer = (userId: string, destination: Destination) => void;

function DropZone({
  className,
  title,
  destination,
  onMove,
  canMove,
  children,
}: {
  readonly className: string;
  readonly title: React.ReactNode;
  readonly destination: Destination;
  readonly onMove: MovePlayer;
  readonly canMove: (userId: string) => boolean;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const titleId = useId();
  return (
    <section
      className={className}
      aria-labelledby={titleId}
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
      <h2 id={titleId} className="team-list-title">
        {title}
      </h2>
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

export function TeamColumns({
  translate,
  draft,
  totals,
  onMove,
}: {
  readonly translate: Translator;
  readonly draft: TeamDraft;
  readonly totals: Readonly<Record<TeamId, TeamTotals>>;
  readonly onMove: MovePlayer;
}): React.JSX.Element {
  return (
    <div className="team-columns">
      {TEAM_IDS.map((team) => (
        <DropZone
          key={team}
          className="team-column"
          destination={team}
          onMove={onMove}
          canMove={isInRoster(draft)}
          title={
            <>
              <span
                className="team-swatch"
                style={{ backgroundColor: draft.teams[team].color }}
                aria-hidden="true"
              />
              {draft.teams[team].name}
            </>
          }
        >
          <ColumnSummary translate={translate} totals={totals[team]} />
          <PlayerList
            translate={translate}
            draft={draft}
            players={teamPlayers(draft, team)}
            team={team}
            emptyText={translate("teams.column.empty")}
            onMove={onMove}
          />
        </DropZone>
      ))}
    </div>
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
        <DropZone
          key={origin}
          className="team-bench-list"
          destination="bench"
          onMove={onMove}
          canMove={isInRoster(draft)}
          title={translate(`teams.${origin}.title`)}
        >
          <PlayerList
            translate={translate}
            draft={draft}
            players={benchPlayers(draft, origin)}
            team={null}
            emptyText={translate(`teams.${origin}.empty`)}
            onMove={onMove}
          />
        </DropZone>
      ))}
    </div>
  );
}
