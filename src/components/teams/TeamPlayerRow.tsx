import { ArrowsLeftRight } from "@phosphor-icons/react/dist/ssr/ArrowsLeftRight";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { Icon } from "@/components/Icon";
import { MemberAvatar } from "@/components/MemberAvatar";
import { useIsPhone } from "@/components/use-is-phone";
import { positionName } from "@/lib/club/club-positions";
import { formatOverallRating } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import {
  TEAM_IDS,
  type TeamId,
  type TeamLabel,
  type TeamLabels,
} from "@/lib/teams/team-ids";
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
 *
 * En el móvil (#762) la fila crece: avatar de 38 px, el nombre en hasta dos
 * líneas y debajo "{posición} · OVR x.x", sin la columna del OVR. Añadir
 * pierde el nombre corto y lleva un "+" dentro del punto.
 */

/** En píxeles, como `.team-avatar` y `.team-avatar-ringed`: en un equipo el
 * avatar crece para el anillo de su color (#757); en el banco no lo lleva. */
const BENCH_AVATAR_SIZE = 32;
const TEAM_AVATAR_SIZE = 34;
/** Como `.team-avatar` en el móvil, con anillo o sin él. */
const PHONE_AVATAR_SIZE = 38;

/** Lo que ocupa el OVR de quien no tiene evaluación. */
const UNRATED_MARK = "—";

/** El tipo que viaja en el arrastre: el `userId` del jugador. */
export const PLAYER_DRAG_TYPE = "text/plain";

function otherTeam(team: TeamId): TeamId {
  return team === "a" ? "b" : "a";
}

function AddButtonContent({
  team,
  isPhone,
}: {
  readonly team: TeamLabel;
  readonly isPhone: boolean;
}): React.JSX.Element {
  const dotStyle = { backgroundColor: team.color };
  if (isPhone) {
    return (
      <span
        className="team-add-dot team-add-dot-plus"
        aria-hidden="true"
        style={dotStyle}
      >
        <Icon glyph={Plus} weight="bold" />
      </span>
    );
  }
  return (
    <>
      <span className="team-add-dot" aria-hidden="true" style={dotStyle} />
      {shortTeamName(team.name)}
    </>
  );
}

function MoveButtons({
  translate,
  player,
  team,
  teams,
  isPhone,
  onMove,
}: {
  readonly translate: Translator;
  readonly player: RosterPlayer;
  /** El equipo en el que está, o null si está en una lista. */
  readonly team: TeamId | null;
  readonly teams: TeamLabels;
  readonly isPhone: boolean;
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
            <AddButtonContent team={teams[target]} isPhone={isPhone} />
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

/** La línea de debajo del nombre en el móvil: "Ataque · OVR 8.1", o
 * "Ataque · Sin evaluar". */
function PhonePlayerLine({
  translate,
  player,
}: {
  readonly translate: Translator;
  readonly player: RosterPlayer;
}): React.JSX.Element {
  const rating = player.isUnrated
    ? translate("teams.player.unrated")
    : translate("teams.player.overall", {
        rating: formatOverallRating(translate.locale, player.rating),
      });
  return (
    <span className="team-player-line">
      {player.position === null
        ? null
        : `${positionName(player.position.names, translate.locale)} · `}
      <span className="team-player-ovr">{rating}</span>
    </span>
  );
}

function PlayerHints({
  translate,
  player,
  isPhone,
}: {
  readonly translate: Translator;
  readonly player: RosterPlayer;
  readonly isPhone: boolean;
}): React.JSX.Element {
  return (
    <span className="team-player-hints">
      {isPhone ? (
        <PhonePlayerLine translate={translate} player={player} />
      ) : null}
      {player.position === null || isPhone ? null : (
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
  );
}

function avatarSize(isPhone: boolean, isRinged: boolean): number {
  if (isPhone) {
    return PHONE_AVATAR_SIZE;
  }
  return isRinged ? TEAM_AVATAR_SIZE : BENCH_AVATAR_SIZE;
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
  const isPhone = useIsPhone();
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
        size={avatarSize(isPhone, ringColor !== null)}
        className={
          ringColor === null ? "team-avatar" : "team-avatar team-avatar-ringed"
        }
        style={ringColor === null ? undefined : { borderColor: ringColor }}
      />
      <div className="team-player-text">
        <span className="team-player-name">{player.fullName}</span>
        <PlayerHints translate={translate} player={player} isPhone={isPhone} />
      </div>
      {isPhone ? null : <PlayerRating translate={translate} player={player} />}
      <div className="team-moves" role="group" aria-label={player.fullName}>
        <MoveButtons
          translate={translate}
          player={player}
          team={team}
          teams={teams}
          isPhone={isPhone}
          onMove={onMove}
        />
      </div>
    </li>
  );
}
