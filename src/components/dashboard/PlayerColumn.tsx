import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { IdentificationBadge } from "@phosphor-icons/react/dist/ssr/IdentificationBadge";
import Link from "next/link";
import { useId } from "react";
import {
  ATTENDANCE_STATUSES,
  type AttendanceStatus,
} from "@/lib/attendance/attendance-status";
import type { SeasonAttendance } from "@/lib/attendance/season-attendance";
import { PAYMENTS_PATH } from "@/lib/auth/routes";
import type {
  ActiveMembershipSummary,
  DashboardMe,
  RestrictedMembershipSummary,
} from "@/lib/dashboard/dashboard";
import { formatCalendarDay } from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";
import type { MembershipBlock } from "@/lib/membership/membership";

/**
 * La columna del Player en el inicio (#749, RF-5 del PRD de E27): "Mi
 * asistencia" de la temporada con las últimas 10 sesiones (D13), y la
 * membresía con la flecha a Pagos. A quien no la tiene al día le dice su
 * bloqueo (D8). Admin, Coach y Committee ven en su lugar la de gestión (D3).
 *
 * En el móvil las dos tarjetas van lado a lado: la asistencia se queda en el
 * porcentaje y una barra pequeña, y lo demás lo esconde el CSS.
 */

type DashboardMembership =
  ActiveMembershipSummary | RestrictedMembershipSummary;

const STATUS_KEYS = {
  present: "attendance.status.present",
  late: "attendance.status.late",
  absent: "attendance.status.absent",
} as const satisfies Record<AttendanceStatus, MessageKey>;

const BLOCK_TITLE_KEYS = {
  pending: "dashboard.membershipCard.pending",
  past_due: "dashboard.membershipCard.pastDue",
  cancelled: "dashboard.membershipCard.expired",
} as const satisfies Record<MembershipBlock, MessageKey>;

const BLOCK_DETAIL_KEYS = {
  pending: "dashboard.membershipCard.pendingDetail",
  past_due: "dashboard.membershipCard.pastDueDetail",
  cancelled: "dashboard.membershipCard.renewInPayments",
} as const satisfies Record<MembershipBlock, MessageKey>;

function LastTenSessions({
  translate,
  last10,
}: {
  readonly translate: Translator;
  readonly last10: SeasonAttendance["last10"];
}): React.JSX.Element {
  return (
    <div className="dashboard-attendance-last10">
      <p className="dashboard-attendance-caption" aria-hidden="true">
        {translate("dashboard.attendance.last10")}
      </p>
      <ol
        className="dashboard-attendance-blocks"
        aria-label={translate("dashboard.attendance.last10.label")}
      >
        {last10.map((session) => (
          <li
            key={session.eventId}
            className={`dashboard-attendance-block dashboard-attendance-block-${session.status}`}
          >
            <span className="visually-hidden">
              {translate("dashboard.attendance.session", {
                date: formatCalendarDay(translate.locale, session.startsOn),
                status: translate(STATUS_KEYS[session.status]),
              })}
            </span>
          </li>
        ))}
      </ol>
      <ul
        className="dashboard-attendance-legend"
        aria-label={translate("dashboard.attendance.legend")}
      >
        {ATTENDANCE_STATUSES.map((status) => (
          <li key={status} className={`dashboard-attendance-legend-${status}`}>
            {translate(STATUS_KEYS[status])}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SeasonFigures({
  translate,
  attendance,
}: {
  readonly translate: Translator;
  readonly attendance: SeasonAttendance;
}): React.JSX.Element {
  return (
    <>
      <p className="dashboard-attendance-figures">
        <span className="dashboard-attendance-percent">
          {translate("dashboard.attendance.percent", {
            percent: attendance.percent,
          })}
        </span>
        <span className="dashboard-attendance-sessions">
          {translate("dashboard.attendance.sessions", {
            attended: attendance.attended,
            count: attendance.sessions,
          })}
        </span>
      </p>
      <LastTenSessions translate={translate} last10={attendance.last10} />
    </>
  );
}

function AttendanceBody({
  translate,
  attendance,
  onRetry,
}: {
  readonly translate: Translator;
  readonly attendance: DashboardMe["attendance"];
  readonly onRetry: () => void;
}): React.JSX.Element {
  if (attendance === null) {
    return (
      <p className="dashboard-attendance-empty">
        {translate("dashboard.attendance.none")}
      </p>
    );
  }
  if ("kind" in attendance) {
    return (
      <div className="dashboard-attendance-empty">
        <p>{translate("dashboard.attendance.unavailable")}</p>
        <button type="button" className="admin-secondary" onClick={onRetry}>
          {translate("dashboard.retry")}
        </button>
      </div>
    );
  }
  return <SeasonFigures translate={translate} attendance={attendance} />;
}

function AttendanceCard({
  translate,
  attendance,
  onRetry,
}: {
  readonly translate: Translator;
  readonly attendance: DashboardMe["attendance"];
  readonly onRetry: () => void;
}): React.JSX.Element {
  const titleId = useId();
  return (
    <section className="dashboard-attendance" aria-labelledby={titleId}>
      <div className="dashboard-attendance-header">
        <h2 id={titleId}>{translate("dashboard.attendance.title")}</h2>
        <p className="dashboard-attendance-season">
          {translate("dashboard.attendance.season")}
        </p>
      </div>
      <AttendanceBody
        translate={translate}
        attendance={attendance}
        onRetry={onRetry}
      />
    </section>
  );
}

function describeActive(
  translate: Translator,
  { plan, renewsOn }: ActiveMembershipSummary,
): string | null {
  const date =
    renewsOn === null ? null : formatCalendarDay(translate.locale, renewsOn);
  if (plan === null) {
    return date === null
      ? null
      : translate("dashboard.membershipCard.renews", { date });
  }
  return date === null
    ? translate("dashboard.membershipCard.plan", { plan })
    : translate("dashboard.membershipCard.planRenews", { plan, date });
}

function describeRestricted(
  translate: Translator,
  { block, endedOn }: RestrictedMembershipSummary,
): string {
  return block === "cancelled" && endedOn !== null
    ? translate("dashboard.membershipCard.expiredOn", {
        date: formatCalendarDay(translate.locale, endedOn),
      })
    : translate(BLOCK_DETAIL_KEYS[block]);
}

function describeMembership(
  translate: Translator,
  membership: DashboardMembership,
): { readonly title: string; readonly detail: string | null } {
  return membership.status === "active"
    ? {
        title: translate("dashboard.membershipCard.active"),
        detail: describeActive(translate, membership),
      }
    : {
        title: translate(BLOCK_TITLE_KEYS[membership.block]),
        detail: describeRestricted(translate, membership),
      };
}

function MembershipCard({
  translate,
  membership,
}: {
  readonly translate: Translator;
  readonly membership: DashboardMembership;
}): React.JSX.Element {
  const titleId = useId();
  const { title, detail } = describeMembership(translate, membership);
  return (
    <section
      className={`dashboard-membership-card dashboard-membership-card-${membership.status}`}
      aria-labelledby={titleId}
    >
      <h2 id={titleId} className="visually-hidden">
        {translate("dashboard.membershipCard.title")}
      </h2>
      <span className="dashboard-membership-card-icon" aria-hidden="true">
        <IdentificationBadge focusable="false" size={20} />
      </span>
      <div className="dashboard-membership-card-text">
        <p className="dashboard-membership-card-title">{title}</p>
        {detail === null ? null : <p>{detail}</p>}
      </div>
      <Link
        href={PAYMENTS_PATH}
        className="dashboard-membership-card-link"
        aria-label={translate("dashboard.membershipCard.open")}
      >
        <CaretRight aria-hidden="true" focusable="false" size={18} />
      </Link>
    </section>
  );
}

export function PlayerColumn({
  translate,
  attendance,
  membership,
  onRetry,
}: {
  readonly translate: Translator;
  readonly attendance: DashboardMe["attendance"];
  readonly membership: DashboardMembership;
  /** Vuelve a pedir el inicio cuando la asistencia no se pudo leer. */
  readonly onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="dashboard-player-column">
      <AttendanceCard
        translate={translate}
        attendance={attendance}
        onRetry={onRetry}
      />
      <MembershipCard translate={translate} membership={membership} />
    </div>
  );
}
