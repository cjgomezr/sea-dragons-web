import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { TShirt } from "@phosphor-icons/react/dist/ssr/TShirt";
import { UsersThree } from "@phosphor-icons/react/dist/ssr/UsersThree";
import Link from "next/link";
import {
  CALENDAR_EVENT_QUERY_PARAM,
  CALENDAR_PATH,
  TEAMS_EVENT_QUERY_PARAM,
  TEAMS_PATH,
} from "@/lib/auth/routes";
import { positionName } from "@/lib/club/club-positions";
import type { NextUpTeam } from "@/lib/dashboard/dashboard";
import type { Translator } from "@/lib/i18n/translator";
import { nameTeamColor } from "@/lib/teams/team-color-name";

/**
 * Lo que la tarjeta "Próximo" (#747, RF-3 y D6 del PRD de E27) dice del
 * reparto: a quien juega, en qué equipo, con qué peto y en qué posición; a
 * Admin y Coach, que lo guardaron sin publicar. El color tiñe la franja, pero
 * el equipo y el nombre de su color van siempre escritos.
 */

const PART_SEPARATOR = " · ";

function lineupsHref(eventId: string): string {
  return `${CALENDAR_PATH}?${CALENDAR_EVENT_QUERY_PARAM}=${eventId}`;
}

function teamBuilderHref(eventId: string): string {
  return `${TEAMS_PATH}?${TEAMS_EVENT_QUERY_PARAM}=${eventId}`;
}

/** "peto azul · Defensa", o sólo el peto si no tiene posición. */
function describeBibAndPosition(
  translate: Translator,
  team: NextUpTeam,
): string {
  const bib = translate("dashboard.nextUp.bib", {
    color: translate(`calendar.teams.color.${nameTeamColor(team.color)}`),
  });
  return team.position === null
    ? bib
    : `${bib}${PART_SEPARATOR}${positionName(team.position.names, translate.locale)}`;
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
          {PART_SEPARATOR}
          {describeBibAndPosition(translate, team)}
        </p>
      </div>
      <Link href={lineupsHref(eventId)} className="dashboard-next-up-team-link">
        {translate("dashboard.nextUp.lineups")}
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
