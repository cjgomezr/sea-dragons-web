import { MemberAvatar } from "@/components/MemberAvatar";
import { positionName } from "@/lib/club/club-positions";
import { formatOverallRating } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { TEAM_IDS, type TeamId, type TeamLabels } from "@/lib/teams/team-ids";
import type { Destination, RosterPlayer } from "./team-draft";

/**
 * Un jugador del builder (#402): el avatar, el nombre, la posición, el OVR o
 * "sin evaluar", y los botones que lo mueven. Los botones son el camino
 * principal y accesible; arrastrar la fila es un atajo del escritorio (el
 * móvil no manda los eventos de arrastre de HTML5).
 *
 * Los botones van en un grupo con el nombre del jugador, como el segmento de
 * Asistencia, y cada uno dice además a quién mueve y a dónde.
 */

/** En píxeles, como `.team-avatar`. */
const AVATAR_SIZE = 32;

/** El tipo que viaja en el arrastre: el `userId` del jugador. */
export const PLAYER_DRAG_TYPE = "text/plain";

function otherTeam(team: TeamId): TeamId {
  return team === "a" ? "b" : "a";
}

function MoveButtons({
  translate,
  player,
  team,
  teams,
  onMove,
}: {
  readonly translate: Translator;
  readonly player: RosterPlayer;
  /** El equipo en el que está, o null si está en una lista. */
  readonly team: TeamId | null;
  readonly teams: TeamLabels;
  readonly onMove: (destination: Destination) => void;
}): React.JSX.Element {
  const named = { player: player.fullName };
  if (team === null) {
    return (
      <>
        {TEAM_IDS.map((target) => (
          <button
            key={target}
            type="button"
            className="team-move"
            aria-label={translate("teams.move.toNamed", {
              ...named,
              team: teams[target].name,
            })}
            onClick={() => onMove(target)}
          >
            {translate("teams.move.to", { team: teams[target].name })}
          </button>
        ))}
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        className="team-move"
        aria-label={translate("teams.move.switchNamed", {
          ...named,
          team: teams[otherTeam(team)].name,
        })}
        onClick={() => onMove(otherTeam(team))}
      >
        {translate("teams.move.switch")}
      </button>
      <button
        type="button"
        className="team-move"
        aria-label={translate("teams.move.removeNamed", {
          ...named,
          team: teams[team].name,
        })}
        onClick={() => onMove("bench")}
      >
        {translate("teams.move.remove")}
      </button>
    </>
  );
}

export function TeamPlayerRow({
  translate,
  player,
  team,
  teams,
  onMove,
}: {
  readonly translate: Translator;
  readonly player: RosterPlayer;
  readonly team: TeamId | null;
  readonly teams: TeamLabels;
  readonly onMove: (destination: Destination) => void;
}): React.JSX.Element {
  return (
    <li
      className="team-player"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(PLAYER_DRAG_TYPE, player.userId);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <MemberAvatar
        fullName={player.fullName}
        photoUrl={null}
        size={AVATAR_SIZE}
        className="team-avatar"
      />
      <div className="team-player-text">
        <span className="team-player-name">{player.fullName}</span>
        <span className="team-player-hints">
          {player.position === null ? null : (
            <span className="team-position">
              {positionName(player.position.names, translate.locale)}
            </span>
          )}
          {player.origin === "outside" ? (
            <span className="team-outside">
              {translate("teams.player.outside")}
            </span>
          ) : null}
        </span>
      </div>
      {player.isUnrated ? (
        <span className="team-unrated">
          {translate("teams.player.unrated")}
        </span>
      ) : (
        <span className="team-rating">
          {formatOverallRating(translate.locale, player.rating)}
        </span>
      )}
      <div className="team-moves" role="group" aria-label={player.fullName}>
        <MoveButtons
          translate={translate}
          player={player}
          team={team}
          teams={teams}
          onMove={onMove}
        />
      </div>
    </li>
  );
}
