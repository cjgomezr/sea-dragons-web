import { IdentificationBadge } from "@phosphor-icons/react/dist/ssr/IdentificationBadge";
import Link from "next/link";
import { PAYMENTS_PATH } from "@/lib/auth/routes";
import { formatCalendarDay } from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";
import type {
  MembershipPlan,
  MembershipStatus,
} from "@/lib/membership/membership";
import { SideCard } from "./SideCard";

/**
 * La membresía en la columna derecha del perfil y de la ficha (#774, RF-5
 * del PRD de E30): la baldosa, el plan y su estado, con el día en que se
 * renueva si hay un cobro a la vista. Se ve pero no se edita: el plan se
 * cambia en Pagos (#456), y sólo el socio lleva el enlace.
 */

const STATUS_KEYS = {
  pending: "account.membership.status.pending",
  trialing: "account.membership.status.trialing",
  active: "account.membership.status.active",
  past_due: "account.membership.status.pastDue",
  cancelled: "account.membership.status.cancelled",
  waived: "account.membership.status.waived",
} as const satisfies Record<MembershipStatus, MessageKey>;

/** Los únicos con un cobro a la vista, como en `nextChargeOf`. */
const RENEWING_STATUSES: ReadonlySet<MembershipStatus> = new Set([
  "active",
  "trialing",
]);

export type ProfileMembership = {
  readonly plan: MembershipPlan | null;
  /** Null sin membresía. */
  readonly status: MembershipStatus | null;
  /** YYYY-MM-DD, el próximo cobro, o null si no hay ninguno a la vista. */
  readonly renewsOn: string | null;
};

function describeStatus(
  translate: Translator,
  { status, renewsOn }: ProfileMembership,
): string {
  if (status === null) {
    return translate("account.membership.status.none");
  }
  const text = translate(STATUS_KEYS[status]);
  // La exención la da el Admin sin volver a pedir la ficha: el día que traía
  // ya no es un cobro.
  return renewsOn === null || !RENEWING_STATUSES.has(status)
    ? text
    : translate("account.membership.renews", {
        status: text,
        date: formatCalendarDay(translate.locale, renewsOn),
      });
}

export function MembershipCard({
  translate,
  headingId,
  membership,
  hasPaymentsLink,
}: {
  translate: Translator;
  headingId: string;
  membership: ProfileMembership;
  /** Sólo en el perfil propio: es quien paga. */
  hasPaymentsLink: boolean;
}): React.JSX.Element {
  return (
    <SideCard
      headingId={headingId}
      isSummary
      title={translate("account.membership.title")}
      action={
        hasPaymentsLink ? (
          <Link href={PAYMENTS_PATH} className="profile-side-card-link">
            {translate("account.membership.payments")}
          </Link>
        ) : null
      }
    >
      <div className="profile-membership">
        <span className="profile-membership-tile" aria-hidden="true">
          <IdentificationBadge focusable="false" weight="regular" />
        </span>
        <div className="profile-membership-text">
          <p className="profile-membership-plan">
            {membership.plan ?? translate("account.membership.noPlan")}
          </p>
          <p>{describeStatus(translate, membership)}</p>
        </div>
      </div>
    </SideCard>
  );
}
