"use client";

import { useId } from "react";
import { formatAudCents } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { formatCardBrand } from "@/lib/membership/card-brand";
import type { CheckoutReturn } from "@/lib/membership/checkout-return";
import type {
  MembershipCard,
  MembershipPlan,
  MembershipStatus,
} from "@/lib/membership/membership";
import type {
  MembershipPanelView,
  MembershipView,
} from "@/lib/membership/membership-view";
import { formatClubDay } from "./format-club-day";
import { requestCardUpdate, requestCheckout } from "./payments-client";
import { PlanChange } from "./PlanChange";
import { PlanChoice } from "./PlanChoice";
import { StripeSessionButton } from "./StripeSessionButton";
import type { Waiting } from "./use-membership-wait";

/**
 * La tarjeta "Plan actual" del mockup de Pagos (#455, RF-5 del PRD de E12):
 * el plan con su precio, el chip de estado, el próximo cobro, la tarjeta o la
 * exención, y lo que el socio puede hacer según su estado. A quien aún no
 * puso tarjeta le ofrece elegir plan (#479) y el alta en Checkout (#454), y
 * a quien ya tiene suscripción, el cambio de plan (#456).
 */

/** El chip lleva siempre la palabra: el color sólo la acompaña. */
type ChipTone = "positive" | "attention" | "negative";

const CHIP_TONES: Readonly<Record<MembershipStatus, ChipTone>> = {
  active: "positive",
  trialing: "positive",
  waived: "positive",
  pending: "attention",
  past_due: "negative",
  cancelled: "negative",
};

const EXPIRY_MONTH_DIGITS = 2;

function describeCard(translate: Translator, card: MembershipCard): string {
  const month = String(card.expMonth).padStart(EXPIRY_MONTH_DIGITS, "0");
  return translate("payments.plan.card", {
    brand: formatCardBrand(card.brand),
    last4: card.last4,
    expiry: `${month}/${card.expYear}`,
  });
}

function chipLabel(
  translate: Translator,
  membership: MembershipPanelView,
): string {
  switch (membership.status) {
    case "trialing":
      return membership.trialEnd === null
        ? translate("payments.status.trialing")
        : translate("payments.trialing", {
            date: formatClubDay(translate, membership.trialEnd),
          });
    case "active":
      return translate("payments.status.active");
    case "pending":
      return translate("payments.status.pending");
    case "past_due":
      return translate("payments.status.pastDue");
    case "cancelled":
      return translate("payments.status.cancelled");
    case "waived":
      return translate("payments.status.waived");
  }
}

function StatusChip({
  translate,
  membership,
}: {
  readonly translate: Translator;
  readonly membership: MembershipPanelView;
}): React.JSX.Element {
  return (
    <span
      className={`payments-chip payments-chip-${CHIP_TONES[membership.status]}`}
    >
      {chipLabel(translate, membership)}
    </span>
  );
}

function isRecurringPlan(plan: MembershipPlan | null): boolean {
  return plan === "Full" || plan === "Student";
}

/** El plan guardado con su precio. Quien aún elige lo ve en las opciones. */
function CurrentPlan({
  translate,
  membership,
}: {
  readonly translate: Translator;
  readonly membership: MembershipPanelView;
}): React.JSX.Element | null {
  const { plan, monthlyPriceCents } = membership;
  if (plan === null) {
    return null;
  }
  return (
    <>
      <p className="payments-plan-name">
        {translate("payments.plan.name", { plan })}
      </p>
      {isRecurringPlan(plan) ? (
        <p className="payments-price">
          {describeMonthlyPrice(translate, monthlyPriceCents)}
        </p>
      ) : null}
    </>
  );
}

/** Quien aún no ha pagado elige plan entre las opciones (#479), que ya
 * dicen el precio; los demás ven el plan que tienen. Mientras se espera a
 * Stripe no se elige nada. */
function PlanSummary({
  translate,
  membership,
  waiting,
  onViewReplaced,
}: {
  readonly translate: Translator;
  readonly membership: MembershipPanelView;
  readonly waiting: Waiting;
  readonly onViewReplaced: (view: MembershipView) => void;
}): React.JSX.Element | null {
  if (membership.canChoosePlan && !isWaitingForSubscription(waiting)) {
    return (
      <PlanChoice
        translate={translate}
        membership={membership}
        onSaved={onViewReplaced}
      />
    );
  }
  return <CurrentPlan translate={translate} membership={membership} />;
}

/** El precio lo lee de Stripe el endpoint (#486). Nulo en un plan con cuota
 * es que Stripe no lo dio, y entonces se dice en vez de inventarlo. */
function describeMonthlyPrice(
  translate: Translator,
  monthlyPriceCents: number | null,
): string {
  return monthlyPriceCents === null
    ? translate("payments.plan.priceUnavailable")
    : translate("payments.plan.monthlyPrice", {
        price: formatAudCents(translate.locale, monthlyPriceCents),
      });
}

/** El próximo cobro o, para Casual, que no lo hay (FR-065); la tarjeta; y
 * la exención con su motivo, su fin y, si tenía suscripción, cuándo termina
 * ésta (#457). */
function PlanDetails({
  translate,
  membership,
}: {
  readonly translate: Translator;
  readonly membership: MembershipPanelView;
}): React.JSX.Element {
  const { plan, nextChargeAt, card, waiver, subscriptionEndsAt } = membership;
  return (
    <ul className="payments-plan-details">
      {plan === "Casual" ? (
        <li>{translate("payments.plan.noRecurringCharge")}</li>
      ) : null}
      {nextChargeAt === null ? null : (
        <li>
          {translate("payments.plan.nextCharge", {
            date: formatClubDay(translate, nextChargeAt),
          })}
        </li>
      )}
      {card === null ? null : <li>{describeCard(translate, card)}</li>}
      {waiver === null ? null : (
        <li>
          {translate("payments.waiver.reason", { reason: waiver.reason })}
        </li>
      )}
      {waiver === null || waiver.until === null ? null : (
        <li>
          {translate("payments.waiver.until", {
            date: formatClubDay(translate, waiver.until),
          })}
        </li>
      )}
      {subscriptionEndsAt === null ? null : (
        <li>
          {translate("payments.waiver.subscriptionEnds", {
            date: formatClubDay(translate, subscriptionEndsAt),
          })}
        </li>
      )}
    </ul>
  );
}

function isWaitingForSubscription(waiting: Waiting): boolean {
  return waiting.kind !== "none" && waiting.target.kind === "subscription";
}

/** Lo que se dice mientras el webhook de la suscripción no llega, en vez de
 * ofrecer otra. */
function SubscriptionWaitStatus({
  translate,
  waiting,
}: {
  readonly translate: Translator;
  readonly waiting: Waiting;
}): React.JSX.Element {
  return (
    <p className="payments-status" role="status">
      {translate(
        waiting.kind === "polling"
          ? "payments.checkout.waiting"
          : "payments.checkout.timedOut",
      )}
    </p>
  );
}

/** Cambiar la tarjeta a quien Stripe le cobra o le falló el cobro, y volver
 * a suscribirse a quien canceló (sin prueba si ya la tuvo, #454). La
 * exención no tiene nada que tocar. A quien le falló el cobro se le ofrece
 * aunque la base no sepa su tarjeta: es su única salida, y tiene cliente en
 * Stripe porque tiene suscripción. */
function PlanActions({
  translate,
  membership,
  waiting,
}: {
  readonly translate: Translator;
  readonly membership: MembershipPanelView;
  readonly waiting: Waiting;
}): React.JSX.Element | null {
  const { status, card, plan } = membership;
  if (isWaitingForSubscription(waiting)) {
    return <SubscriptionWaitStatus translate={translate} waiting={waiting} />;
  }
  const canUpdateCard =
    status === "past_due" ||
    (card !== null && (status === "active" || status === "trialing"));
  if (canUpdateCard) {
    return (
      <div className="payments-plan-actions">
        <StripeSessionButton
          translate={translate}
          label={translate("payments.card.update")}
          requestSession={requestCardUpdate}
        />
      </div>
    );
  }
  if (status === "cancelled" && isRecurringPlan(plan)) {
    return (
      <div className="payments-plan-actions">
        <StripeSessionButton
          translate={translate}
          label={translate("payments.card.resubscribe")}
          requestSession={requestCheckout}
        />
      </div>
    );
  }
  return null;
}

/** Lo que se ofrece a quien no ha puesto tarjeta, según su plan y si los
 * pagos están configurados (RF-3, RF-9). */
function PendingOffer({
  translate,
  view,
  membership,
  waiting,
  checkoutReturn,
}: {
  readonly translate: Translator;
  readonly view: MembershipView;
  readonly membership: MembershipPanelView;
  readonly waiting: Waiting;
  readonly checkoutReturn: CheckoutReturn | null;
}): React.JSX.Element | null {
  if (isWaitingForSubscription(waiting)) {
    return <SubscriptionWaitStatus translate={translate} waiting={waiting} />;
  }
  if (membership.plan === "Casual") {
    return <p>{translate("payments.offer.casual")}</p>;
  }
  if (!isRecurringPlan(membership.plan)) {
    return null;
  }
  if (!view.paymentsConfigured) {
    return <p>{translate("payments.offer.notConfigured")}</p>;
  }
  return (
    <div className="payments-offer">
      {checkoutReturn === "cancelado" ? (
        <p className="payments-status" role="status">
          {translate("payments.checkout.cancelled")}
        </p>
      ) : null}
      <p>
        {translate(
          membership.trialEnd === null
            ? "payments.offer.trial"
            : "payments.offer.noTrial",
        )}
      </p>
      <p className="app-lead">{translate("payments.offer.stripe")}</p>
      <div className="payments-plan-actions">
        <StripeSessionButton
          translate={translate}
          label={translate("payments.offer.addCard")}
          requestSession={requestCheckout}
        />
      </div>
    </div>
  );
}

export function PlanCard({
  translate,
  view,
  membership,
  waiting,
  checkoutReturn,
  onViewReplaced,
  onPlanChanged,
}: {
  readonly translate: Translator;
  readonly view: MembershipView;
  readonly membership: MembershipPanelView;
  readonly waiting: Waiting;
  readonly checkoutReturn: CheckoutReturn | null;
  /** Pagos pinta la membresía que responde la elección de plan. */
  readonly onViewReplaced: (view: MembershipView) => void;
  /** Pagos vuelve a leer la membresía cuando el cambio de plan sale bien. */
  readonly onPlanChanged: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const { status } = membership;
  return (
    <section className="card payments-plan-card" aria-labelledby={titleId}>
      <div className="payments-plan-header">
        <h2 id={titleId} className="payments-eyebrow">
          {translate("payments.plan.title")}
        </h2>
        <StatusChip translate={translate} membership={membership} />
      </div>
      <PlanSummary
        translate={translate}
        membership={membership}
        waiting={waiting}
        onViewReplaced={onViewReplaced}
      />
      <PlanDetails translate={translate} membership={membership} />
      {status === "pending" ? (
        <PendingOffer
          translate={translate}
          view={view}
          membership={membership}
          waiting={waiting}
          checkoutReturn={checkoutReturn}
        />
      ) : null}
      {status !== "pending" && view.paymentsConfigured ? (
        <PlanActions
          translate={translate}
          membership={membership}
          waiting={waiting}
        />
      ) : null}
      {/* Quien elige plan no lo cambia además por el camino del #456. */}
      {membership.canChoosePlan || isWaitingForSubscription(waiting) ? null : (
        <PlanChange
          translate={translate}
          membership={membership}
          onChanged={onPlanChanged}
        />
      )}
    </section>
  );
}
