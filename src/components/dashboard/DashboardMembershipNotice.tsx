import { WarningCircle } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import Link from "next/link";
import { useId } from "react";
import { BLOCK_REASON_KEYS } from "@/components/MembershipNotice";
import { PAYMENTS_PATH } from "@/lib/auth/routes";
import type { RestrictedMembershipSummary } from "@/lib/dashboard/dashboard";
import { formatCalendarDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";

/**
 * El aviso del inicio de quien no tiene la membresía al día (#747, RF-8 y D8
 * del PRD de E27): el título depende del bloqueo, como en `MembershipNotice`,
 * salvo la vencida, que dice cuándo venció si se sabe. "Renovar membresía"
 * lleva siempre a Pagos.
 */

function describeTitle(
  translate: Translator,
  membership: RestrictedMembershipSummary,
): string {
  const { block, endedOn } = membership;
  if (block !== "cancelled") {
    return translate(BLOCK_REASON_KEYS[block]);
  }
  return endedOn === null
    ? translate("dashboard.membership.expired")
    : translate("dashboard.membership.expiredOn", {
        date: formatCalendarDay(translate.locale, endedOn),
      });
}

export function DashboardMembershipNotice({
  translate,
  membership,
}: {
  readonly translate: Translator;
  readonly membership: RestrictedMembershipSummary;
}): React.JSX.Element {
  const titleId = useId();
  return (
    <div
      className="dashboard-membership-notice"
      role="note"
      aria-labelledby={titleId}
    >
      <WarningCircle
        className="dashboard-membership-notice-icon"
        aria-hidden="true"
        focusable="false"
        size={20}
      />
      <div className="dashboard-membership-notice-text">
        <p className="dashboard-membership-notice-title" id={titleId}>
          {describeTitle(translate, membership)}
        </p>
        <p>{translate("dashboard.membership.body")}</p>
      </div>
      <Link href={PAYMENTS_PATH} className="auth-submit">
        {translate("dashboard.membership.renew")}
      </Link>
    </div>
  );
}
