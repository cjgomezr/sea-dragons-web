import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { TShirt } from "@phosphor-icons/react/dist/ssr/TShirt";
import { UsersThree } from "@phosphor-icons/react/dist/ssr/UsersThree";
import Link from "next/link";
import {
  CALENDAR_EVENT_QUERY_PARAM,
  CALENDAR_PATH,
  CALENDAR_VIEW_QUERY_PARAM,
  CALENDAR_VIEW_TEAMS,
  TEAMS_EVENT_QUERY_PARAM,
  TEAMS_PATH,
} from "@/lib/auth/routes";
import { positionName } from "@/lib/club/club-positions";
import type { NextUpTeam } from "@/lib/dashboard/dashboard";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Lo que la tarjeta "Próximo" (#747, RF-3 y D6 del PRD de E27) dice del
 * reparto: a quien juega, en qué equipo y en qué posición; a Admin y Coach,
 * que lo guardaron sin publicar. El color del peto sólo tiñe la camiseta: el
 * nombre del equipo basta. "Ver equipos" abre el evento en sus equipos.
 */

const PART_SEPARATOR = " · ";

/** "Próximo" nunca es pasado, así que no hace falta `periodo=past`. */
function eventTeamsHref(eventId: string): string {
  return `${CALENDAR_PATH}?${CALENDAR_EVENT_QUERY_PARAM}=${eventId}&${CALENDAR_VIEW_QUERY_PARAM}=${CALENDAR_VIEW_TEAMS}`;
}

function teamBuilderHref(eventId: string): string {
  return `${TEAMS_PATH}?${TEAMS_EVENT_QUERY_PARAM}=${eventId}`;
}

export function MyTeamStrip({
  translate,
  eventId,
  team,
}: {
  readonly translate: Translator;
  readonly eventId: string;
  readonly team: NextUpTeam;
}): React.JSX.Element {
  return (
    <div
      className="dashboard-next-up-team"
      style={{ "--team-color": team.color } as React.CSSProperties}
    >
      <span className="dashboard-next-up-team-swatch" aria-hidden="true">
        <TShirt focusable="false" size={18} weight="fill" />
      </span>
      <div className="dashboard-next-up-team-text">
        <p className="dashboard-next-up-eyebrow">
          {translate("calendar.teams.playingInEyebrow")}
        </p>
        <p className="dashboard-next-up-team-line">
          <strong>{team.name}</strong>
          {team.position === null
            ? null
            : `${PART_SEPARATOR}${positionName(team.position.names, translate.locale)}`}
        </p>
      </div>
      <Link
        href={eventTeamsHref(eventId)}
        className="dashboard-next-up-team-link"
      >
        {translate("dashboard.nextUp.seeTeams")}
        <CaretRight aria-hidden="true" focusable="false" size={14} />
      </Link>
    </div>
  );
}

export function UnpublishedTeamsRow({
  translate,
  eventId,
}: {
  readonly translate: Translator;
  readonly eventId: string;
}): React.JSX.Element {
  return (
    <div className="dashboard-next-up-draft">
      <UsersThree
        className="dashboard-next-up-draft-icon"
        aria-hidden="true"
        focusable="false"
        size={20}
      />
      <p>
        {translate("dashboard.nextUp.draft.start")}{" "}
        <strong>{translate("dashboard.nextUp.draft.emphasis")}</strong>
        {translate("dashboard.nextUp.draft.end")}
      </p>
      <Link
        href={teamBuilderHref(eventId)}
        className="dashboard-next-up-row-link"
      >
        {translate("dashboard.nextUp.openTeams")}
        <CaretRight aria-hidden="true" focusable="false" size={14} />
      </Link>
    </div>
  );
}
