import { useId } from "react";
import { type NamedPosition, positionName } from "@/lib/club/club-positions";
import type { Translator } from "@/lib/i18n/translator";
import type { MyTeam, PublishedTeam } from "@/lib/teams/my-team";
import { nameTeamColor } from "@/lib/teams/team-color-name";
import { TEAM_IDS } from "@/lib/teams/team-ids";
import type { EventTeamState } from "./use-event-team";

/**
 * Los equipos en la fila desplegada de la agenda (#403, RF-8 del PRD de E10,
 * FR-048, AC-020), como en `docs/mockups/mobile-team-light.png`: la tarjeta
 * "Juegas en {equipo}" con su color y la posición de quien mira, y debajo la
 * alineación de los dos equipos con nombres y posiciones. Nunca un OVR (D3):
 * la API no lo manda.
 *
 * El color tiñe la tarjeta y la muestra de cada equipo, pero no dice nada que
 * no diga el texto: el nombre del equipo y el de su color van siempre
 * escritos. El lector de pantalla oye la tarjeta como una sola frase.
 */

type Published = Extract<MyTeam, { readonly status: "published" }>;

function describePosition(
  translate: Translator,
  position: NamedPosition | null,
): string {
  return position === null
    ? translate("calendar.teams.noPosition")
    : positionName(position.names, translate.locale);
}

function MyTeamCard({
  translate,
  team,
  position,
}: {
  readonly translate: Translator;
  readonly team: PublishedTeam;
  readonly position: NamedPosition | null;
}): React.JSX.Element {
  const color = translate(`calendar.teams.color.${nameTeamColor(team.color)}`);
  const sentence =
    position === null
      ? translate("calendar.teams.playingInWithoutPosition", {
          team: team.name,
          color,
        })
      : translate("calendar.teams.playingIn", {
          team: team.name,
          color,
          position: positionName(position.names, translate.locale),
        });
  return (
    <div
      className="event-my-team"
      style={{ "--team-color": team.color } as React.CSSProperties}
    >
      <p className="visually-hidden">{sentence}</p>
      <div aria-hidden="true">
        <p className="event-my-team-eyebrow">
          {translate("calendar.teams.playingInEyebrow")}
        </p>
        <p className="event-my-team-name">{team.name}</p>
        <p className="event-my-team-meta">
          {translate("calendar.teams.positionAndColor", {
            position: describePosition(translate, position),
            color,
          })}
        </p>
      </div>
    </div>
  );
}

function Lineup({
  translate,
  team,
}: {
  readonly translate: Translator;
  readonly team: PublishedTeam;
}): React.JSX.Element {
  const headingId = useId();
  return (
    <div className="event-lineup">
      <h4 id={headingId} className="event-lineup-title">
        <span
          className="team-swatch"
          style={{ backgroundColor: team.color }}
          aria-hidden="true"
        />
        {team.name}
      </h4>
      {team.players.length === 0 ? (
        <p className="agenda-detail-empty">
          {translate("calendar.teams.noPlayers")}
        </p>
      ) : (
        <ul className="event-lineup-list" aria-labelledby={headingId}>
          {team.players.map((player) => (
            <li key={player.userId} className="event-lineup-player">
              <span className="event-lineup-name">{player.fullName}</span>
              <span className="team-position">
                {describePosition(translate, player.position)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PublishedTeams({
  translate,
  published,
  isCancelled,
}: {
  readonly translate: Translator;
  readonly published: Published;
  readonly isCancelled: boolean;
}): React.JSX.Element {
  const headingId = useId();
  const { me, teams } = published;
  return (
    <section className="event-teams" aria-labelledby={headingId}>
      <div className="event-teams-heading">
        <h3 id={headingId}>{translate("calendar.teams.heading")}</h3>
        {isCancelled ? (
          <span className="agenda-cancelled">
            {translate("calendar.event.cancelled")}
          </span>
        ) : null}
      </div>
      {me === null ? (
        <p className="agenda-detail-empty">
          {translate("calendar.teams.notAssigned")}
        </p>
      ) : (
        <MyTeamCard
          translate={translate}
          team={teams[me.team]}
          position={me.position}
        />
      )}
      <div className="event-lineups">
        {TEAM_IDS.map((teamId) => (
          <Lineup key={teamId} translate={translate} team={teams[teamId]} />
        ))}
      </div>
    </section>
  );
}

export function EventTeams({
  translate,
  state,
  isCancelled,
  onRetry,
}: {
  readonly translate: Translator;
  readonly state: EventTeamState;
  readonly isCancelled: boolean;
  readonly onRetry: () => void;
}): React.JSX.Element | null {
  switch (state.kind) {
    case "idle":
    case "loading":
      // El detalle ya dice que está cargando: una segunda frase sobra.
      return null;
    case "failed":
      return (
        <div className="agenda-detail-failure">
          <p className="auth-error" role="alert">
            {translate("calendar.teams.error")}
          </p>
          <button type="button" className="admin-secondary" onClick={onRetry}>
            {translate("calendar.teams.retry")}
          </button>
        </div>
      );
    case "loaded":
      // Un borrador o un reparto que no existe no enseña nada de equipos.
      return state.team.status === "not_published" ? null : (
        <PublishedTeams
          translate={translate}
          published={state.team}
          isCancelled={isCancelled}
        />
      );
  }
}
