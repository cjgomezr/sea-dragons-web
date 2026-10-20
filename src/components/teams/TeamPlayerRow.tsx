import { ArrowsLeftRight } from "@phosphor-icons/react/dist/ssr/ArrowsLeftRight";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { Icon } from "@/components/Icon";
import { MemberAvatar } from "@/components/MemberAvatar";
import { positionName } from "@/lib/club/club-positions";
import { formatOverallRating } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { TEAM_IDS, type TeamId, type TeamLabels } from "@/lib/teams/team-ids";
import { shortTeamName } from "@/lib/teams/team-short-name";
import type { Destination, RosterPlayer } from "./team-draft";

/**
 * Un jugador del builder (#402): el avatar, el nombre, la posición, el OVR o
 * "sin evaluar", y los botones que lo mueven. Los botones son el camino
 * principal y accesible; arrastrar la fila es un atajo del escritorio (el
 * móvil no manda los eventos de arrastre de HTML5).
 *
 * Los botones van en un grupo con el nombre del jugador, como el segmento de
 * Asistencia, y cada uno dice además a quién mueve y a dónde. En un equipo
 * son de icono (#759): Cambiar y Quitar sólo tienen nombre accesible. En el
 * banco hay un Añadir por equipo con su punto de color y su nombre corto
 * (#761).
 */

/** En píxeles, como `.team-avatar` y `.team-avatar-ringed`: en un equipo el
 * avatar crece para el anillo de su color (#757); en el banco no lo lleva. */
const BENCH_AVATAR_SIZE = 32;
const TEAM_AVATAR_SIZE = 34;

/** Lo que ocupa el OVR de quien no tiene evaluación. */
const UNRATED_MARK = "—";

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
            className="team-add"
            aria-label={translate("teams.move.addNamed", {
              ...named,
              team: teams[target].name,
            })}
            onClick={() => onMove(target)}
          >
            <span
              className="team-add-dot"
              aria-hidden="true"
              style={{ backgroundColor: teams[target].color }}
            />
            {shortTeamName(teams[target].name)}
          </button>
        ))}
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        className="team-icon-move"
        aria-label={translate("teams.move.toNamed", {
          ...named,
          team: teams[otherTeam(team)].name,
        })}
        onClick={() => onMove(otherTeam(team))}
      >
        <Icon glyph={ArrowsLeftRight} />
      </button>
      <button
        type="button"
        className="team-icon-move team-icon-remove"
        aria-label={translate("teams.move.removeNamed", {
          ...named,
          team: teams[team].name,
        })}
        onClick={() => onMove("bench")}
      >
        <Icon glyph={X} />
      </button>
    </>
  );
}

/** El no evaluado lleva una raya, en un equipo (#759) y en el banco (#761),
 * y el lector oye "Sin evaluar". */
function PlayerRating({
  translate,
  player,
}: {
  readonly translate: Translator;
  readonly player: RosterPlayer;
}): React.JSX.Element {
  if (!player.isUnrated) {
    return (
      <span className="team-rating">
        {formatOverallRating(translate.locale, player.rating)}
      </span>
    );
  }
  return (
    <span className="team-rating team-rating-missing">
      <span aria-hidden="true">{UNRATED_MARK}</span>
      <span className="visually-hidden">
        {translate("teams.player.unrated")}
      </span>
    </span>
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
  const ringColor = team === null ? null : teams[team].color;
  return (
    <li
      className={
        ringColor === null
          ? "team-player team-player-benched"
          : "team-player team-player-assigned"
      }
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(PLAYER_DRAG_TYPE, player.userId);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <MemberAvatar
        fullName={player.fullName}
        photoUrl={player.photoUrl}
        size={ringColor === null ? BENCH_AVATAR_SIZE : TEAM_AVATAR_SIZE}
        className={
          ringColor === null ? "team-avatar" : "team-avatar team-avatar-ringed"
        }
        style={ringColor === null ? undefined : { borderColor: ringColor }}
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
      <PlayerRating translate={translate} player={player} />
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
