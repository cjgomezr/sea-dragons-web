import Link from "next/link";
import { useId } from "react";
import {
  ATTENDANCE_PATH,
  CALENDAR_PATH,
  DIRECTORY_PATH,
  NEWS_PATH,
} from "@/lib/auth/routes";
import type {
  AttendanceTile,
  Dashboard,
  MembersTile,
  NextTrainingTile,
  UnreadNewsTile,
} from "@/lib/dashboard/dashboard";
import { timeUntil } from "@/lib/dashboard/dashboard-view";
import {
  formatCalendarDayParts,
  formatClockTime,
  formatNumber,
  formatPercent,
} from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { ClubMoment } from "@/lib/time/club-calendar";

/**
 * Las cuatro teselas del inicio (#426, RF-1 del PRD de E14), en el orden del
 * mockup. Cada una se oye como "Tasa de asistencia: 86 %" y lleva a su
 * sección; la asistencia propia de un Committee o un Player no lleva a
 * ninguna, porque Asistencia es sólo de Admin y Coach.
 */

/** Lo que pinta una tesela. Sin `href` no es un enlace. */
type TileContent = {
  readonly label: string;
  readonly value: string;
  readonly caption: string | null;
  readonly href: string | null;
};

function unavailableTile(translate: Translator, label: string): TileContent {
  return {
    label,
    value: translate("dashboard.unavailable"),
    caption: null,
    href: null,
  };
}

function describeAttendance(
  translate: Translator,
  tile: AttendanceTile,
): TileContent {
  switch (tile.kind) {
    case "club_rate":
      return {
        label: translate("dashboard.tile.clubRate"),
        value:
          tile.rate.kind === "rate"
            ? formatPercent(translate.locale, tile.rate.percent)
            : translate("dashboard.tile.noData"),
        caption: translate("dashboard.tile.clubRate.caption"),
        href: ATTENDANCE_PATH,
      };
    case "own_attendance":
      return {
        label: translate("dashboard.tile.ownAttendance"),
        value:
          tile.attendance.kind === "rate"
            ? formatPercent(translate.locale, tile.attendance.percent)
            : translate("dashboard.tile.noData"),
        caption:
          tile.attendance.kind === "rate"
            ? translate("dashboard.tile.ownAttendance.caption", {
                count: tile.attendance.sessions,
              })
            : null,
        href: null,
      };
    case "unavailable":
      return unavailableTile(translate, translate("dashboard.tile.attendance"));
  }
}

function describeMembers(
  translate: Translator,
  tile: MembersTile,
): TileContent {
  const label = translate("dashboard.tile.members");
  if (tile.kind === "unavailable") {
    return unavailableTile(translate, label);
  }
  return {
    label,
    value: formatNumber(translate.locale, tile.active),
    caption:
      tile.joinedRecently > 0
        ? translate("dashboard.tile.members.caption", {
            count: tile.joinedRecently,
          })
        : null,
    href: DIRECTORY_PATH,
  };
}

function describeTimeUntil(
  translate: Translator,
  start: ClubMoment,
  now: ClubMoment,
): string {
  const until = timeUntil(start, now);
  switch (until.kind) {
    case "today":
      return translate("dashboard.tile.nextTraining.today", {
        time: formatClockTime(translate.locale, until.time),
      });
    case "hours":
      return translate("dashboard.tile.nextTraining.hours", {
        count: until.hours,
      });
    case "days":
      return translate("dashboard.tile.nextTraining.days", {
        count: until.days,
      });
  }
}

function describeNextTraining(
  translate: Translator,
  tile: NextTrainingTile,
  now: ClubMoment,
): TileContent {
  const label = translate("dashboard.tile.nextTraining");
  switch (tile.kind) {
    case "training": {
      const { training } = tile;
      return {
        label,
        value: describeTimeUntil(
          translate,
          { date: training.startsOn, time: training.startTime },
          now,
        ),
        caption: translate("dashboard.tile.nextTraining.caption", {
          day: formatCalendarDayParts(translate.locale, training.startsOn)
            .weekday,
          location: training.location,
        }),
        href: CALENDAR_PATH,
      };
    }
    case "none":
      return {
        label,
        value: translate("dashboard.tile.nextTraining.none"),
        caption: null,
        href: CALENDAR_PATH,
      };
    case "unavailable":
      return unavailableTile(translate, label);
  }
}

function describeUnreadNews(
  translate: Translator,
  tile: UnreadNewsTile,
): TileContent {
  const label = translate("dashboard.tile.unreadNews");
  if (tile.kind === "unavailable") {
    return unavailableTile(translate, label);
  }
  return {
    label,
    value:
      tile.count === 0
        ? translate("dashboard.tile.unreadNews.none")
        : formatNumber(translate.locale, tile.count),
    caption:
      tile.announcements > 0
        ? translate("dashboard.tile.unreadNews.caption", {
            count: tile.announcements,
          })
        : null,
    href: NEWS_PATH,
  };
}

/** El nombre accesible lleva la etiqueta y el valor; el detalle se oye como
 * descripción. Lo que se ve queda fuera del árbol accesible para no oírlo
 * dos veces. */
function Tile({
  translate,
  content,
}: {
  readonly translate: Translator;
  readonly content: TileContent;
}): React.JSX.Element {
  const captionId = useId();
  const accessibleName = translate("dashboard.tile.accessibleName", {
    label: content.label,
    value: content.value,
  });
  const body = (
    <>
      <span className="dashboard-tile-label" aria-hidden="true">
        {content.label}
      </span>
      <span className="dashboard-tile-value" aria-hidden="true">
        {content.value}
      </span>
      {content.caption === null ? null : (
        <span id={captionId} className="dashboard-tile-caption">
          {content.caption}
        </span>
      )}
    </>
  );
  const describedBy = content.caption === null ? undefined : captionId;
  return (
    <li className="dashboard-tile-item">
      {content.href === null ? (
        <div
          className="dashboard-tile"
          role="group"
          aria-label={accessibleName}
          aria-describedby={describedBy}
        >
          {body}
        </div>
      ) : (
        <Link
          href={content.href}
          className="dashboard-tile"
          aria-label={accessibleName}
          aria-describedby={describedBy}
        >
          {body}
        </Link>
      )}
    </li>
  );
}

export function DashboardTiles({
  translate,
  tiles,
  now,
}: {
  readonly translate: Translator;
  readonly tiles: Dashboard["tiles"];
  /** La hora del club con la que se calculó la pantalla. */
  readonly now: ClubMoment;
}): React.JSX.Element {
  const contents = [
    describeAttendance(translate, tiles.attendance),
    describeMembers(translate, tiles.members),
    describeNextTraining(translate, tiles.nextTraining, now),
    describeUnreadNews(translate, tiles.unreadNews),
  ];
  return (
    <section
      className="dashboard-tiles"
      aria-label={translate("dashboard.tiles.label")}
    >
      <ul className="dashboard-tile-list">
        {contents.map((content) => (
          <Tile key={content.label} translate={translate} content={content} />
        ))}
      </ul>
    </section>
  );
}
