"use client";

import { CalendarBlank } from "@phosphor-icons/react/dist/ssr/CalendarBlank";
import { CreditCard } from "@phosphor-icons/react/dist/ssr/CreditCard";
import { CurrencyDollar } from "@phosphor-icons/react/dist/ssr/CurrencyDollar";
import { useId, useState } from "react";
import { Icon } from "@/components/Icon";
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
import { SessionBalanceSummary } from "./SessionBalanceSummary";
import { SessionPackOffer } from "./SessionPackOffer";
import { StripeSessionButton } from "./StripeSessionButton";
import type { StripeReturns, Waiting } from "./use-membership-wait";

/**
 * El plan actual de Pagos (#455, RF-5 del PRD de E12), como tira de una fila
 * en escritorio y tarjeta compacta en el móvil (#628, RF-2 del PRD de E23):
 * el plan con su chip de estado; debajo el precio, el próximo cobro, la
 * tarjeta o la exención, y el saldo de sesiones (#472); a la derecha Cambiar
 * plan y la tarjeta. A quien aún no puso tarjeta le ofrece elegir plan (#479)
 * y el alta en Checkout (#454) dentro de la misma tira, y a un Casual, sus
 * packs (#471).
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

/** El nombre del plan guardado. Quien aún elige lo ve en las opciones. */
function PlanName({
  translate,
  plan,
}: {
  readonly translate: Translator;
  readonly plan: MembershipPlan | null;
}): React.JSX.Element | null {
  if (plan === null) {
    return null;
  }
  return (
    <p className="payments-plan-name">
      {translate("payments.plan.name", { plan })}
    </p>
  );
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

type Glyph = React.ComponentProps<typeof Icon>["glyph"];

/** En el móvil el precio lleva el icono del dinero y el próximo cobro va a
 * su lado sin el suyo, como en el mockup; en escritorio, al revés. */
function PhoneOnlyIcon({
  glyph,
}: {
  readonly glyph: Glyph;
}): React.JSX.Element {
  return (
    <span className="payments-plan-icon-phone">
      <Icon glyph={glyph} />
    </span>
  );
}

function WideOnlyIcon({ glyph }: { readonly glyph: Glyph }): React.JSX.Element {
  return (
    <span className="payments-plan-icon-wide">
      <Icon glyph={glyph} />
    </span>
  );
}

/** Un dato de la segunda línea de la tira, con su icono si lo lleva. */
function PlanDetail({
  className,
  icon,
  children,
}: {
  readonly className?: string;
  readonly icon?: React.ReactNode;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <li className={className}>
      {icon}
      <span>{children}</span>
    </li>
  );
}

/** El precio de quien tiene cuota, salvo mientras elige plan; el próximo
 * cobro o, para Casual, que no lo hay (FR-065); la tarjeta; y la exención
 * con su motivo, su fin y, si tenía suscripción, cuándo termina ésta
 * (#457). */
function PlanDetails({
  translate,
  membership,
  showsPrice,
}: {
  readonly translate: Translator;
  readonly membership: MembershipPanelView;
  readonly showsPrice: boolean;
}): React.JSX.Element {
  const { plan, nextChargeAt, card, waiver, subscriptionEndsAt } = membership;
  return (
    <ul className="payments-plan-details">
      {showsPrice ? (
        <PlanDetail
          className="payments-plan-detail-price"
          icon={<PhoneOnlyIcon glyph={CurrencyDollar} />}
        >
          {describeMonthlyPrice(translate, membership.monthlyPriceCents)}
        </PlanDetail>
      ) : null}
      {plan === "Casual" ? (
        <PlanDetail>{translate("payments.plan.noRecurringCharge")}</PlanDetail>
      ) : null}
      {nextChargeAt === null ? null : (
        <PlanDetail
          className="payments-plan-detail-next-charge"
          icon={<WideOnlyIcon glyph={CalendarBlank} />}
        >
          {translate("payments.plan.nextCharge", {
            date: formatClubDay(translate, nextChargeAt),
          })}
        </PlanDetail>
      )}
      {card === null ? null : (
        <PlanDetail icon={<Icon glyph={CreditCard} />}>
          {describeCard(translate, card)}
        </PlanDetail>
      )}
      {waiver === null ? null : (
        <PlanDetail>
          {translate("payments.waiver.reason", { reason: waiver.reason })}
        </PlanDetail>
      )}
      {waiver === null || waiver.until === null ? null : (
        <PlanDetail>
          {translate("payments.waiver.until", {
            date: formatClubDay(translate, waiver.until),
          })}
        </PlanDetail>
      )}
      {subscriptionEndsAt === null ? null : (
        <PlanDetail>
          {translate("payments.waiver.subscriptionEnds", {
            date: formatClubDay(translate, subscriptionEndsAt),
          })}
        </PlanDetail>
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
}: {
  readonly translate: Translator;
  readonly membership: MembershipPanelView;
}): React.JSX.Element | null {
  const { status, card, plan } = membership;
  const canUpdateCard =
    status === "past_due" ||
    (card !== null && (status === "active" || status === "trialing"));
  if (canUpdateCard) {
    return (
      <div className="payments-plan-button-slot">
        <StripeSessionButton
          translate={translate}
          label={translate("payments.card.update")}
          requestSession={requestCardUpdate}
          appearance="secondary"
        />
      </div>
    );
  }
  if (status === "cancelled" && isRecurringPlan(plan)) {
    return (
      <div className="payments-plan-button-slot">
        <StripeSessionButton
          translate={translate}
          label={translate("payments.card.resubscribe")}
          requestSession={requestCheckout}
          appearance="secondary"
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
  checkoutReturn,
}: {
  readonly translate: Translator;
  readonly view: MembershipView;
  readonly membership: MembershipPanelView;
  readonly checkoutReturn: CheckoutReturn | null;
}): React.JSX.Element | null {
  if (membership.plan === null) {
    return null;
  }
  if (!view.paymentsConfigured) {
    return <p>{translate("payments.offer.notConfigured")}</p>;
  }
  // Un Casual se pone al día con un pack: la tira le ofrece los suyos.
  if (!isRecurringPlan(membership.plan)) {
    return null;
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

type StripPlan = {
  readonly translate: Translator;
  readonly view: MembershipView;
  readonly membership: MembershipPanelView;
  readonly waiting: Waiting;
};

type PlanPickerToggle = {
  readonly id: string;
  readonly isOpen: boolean;
  readonly toggle: () => void;
};

/** Quien aún no ha pagado elige plan entre las opciones (#479), que ya
 * dicen el precio. Mientras se espera a Stripe no se elige nada. */
function isChoosingPlan({ membership, waiting }: StripPlan): boolean {
  return membership.canChoosePlan && !isWaitingForSubscription(waiting);
}

/** Quien elige plan no lo cambia además por el camino del #456. */
function offersPlanChange({ membership, waiting }: StripPlan): boolean {
  return !membership.canChoosePlan && !isWaitingForSubscription(waiting);
}

function canOpenPlanPicker(strip: StripPlan): boolean {
  const { membership } = strip;
  return (
    offersPlanChange(strip) &&
    membership.canChangePlan &&
    membership.scheduledChange === null
  );
}

function usePlanPickerToggle(): PlanPickerToggle {
  const id = useId();
  const [isOpen, setIsOpen] = useState(false);
  return { id, isOpen, toggle: () => setIsOpen((open) => !open) };
}

/** La parte izquierda: el plan y su chip, y debajo sus datos. */
function PlanOverview({
  strip,
}: {
  readonly strip: StripPlan;
}): React.JSX.Element {
  const { translate, view, membership } = strip;
  const isChoosing = isChoosingPlan(strip);
  return (
    <div className="payments-plan-overview">
      <div className="payments-plan-heading">
        {isChoosing ? null : (
          <PlanName translate={translate} plan={membership.plan} />
        )}
        <StatusChip translate={translate} membership={membership} />
      </div>
      <PlanDetails
        translate={translate}
        membership={membership}
        showsPrice={!isChoosing && isRecurringPlan(membership.plan)}
      />
      <SessionBalanceSummary
        translate={translate}
        plan={membership.plan}
        sessionBalance={view.sessionBalance}
      />
    </div>
  );
}

/** La parte derecha: Cambiar plan, que abre el selector bajo la tira, y
 * Actualizar tarjeta o Volver a suscribirse. */
function PlanButtons({
  strip,
  picker,
}: {
  readonly strip: StripPlan;
  readonly picker: PlanPickerToggle;
}): React.JSX.Element {
  const { translate, view, membership, waiting } = strip;
  const offersCardActions =
    membership.status !== "pending" &&
    view.paymentsConfigured &&
    !isWaitingForSubscription(waiting);
  return (
    <div className="payments-plan-buttons">
      {canOpenPlanPicker(strip) ? (
        <div className="payments-plan-button-slot">
          <button
            type="button"
            className="payments-plan-button"
            aria-expanded={picker.isOpen}
            aria-controls={picker.isOpen ? picker.id : undefined}
            onClick={picker.toggle}
          >
            {translate("payments.planChange.open")}
          </button>
        </div>
      ) : null}
      {offersCardActions ? (
        <PlanActions translate={translate} membership={membership} />
      ) : null}
    </div>
  );
}

/** El selector del #456 cuando se abre, o el cambio ya programado con su
 * anulación, que se ve siempre. */
function PlanChangeArea({
  strip,
  picker,
  onPlanChanged,
}: {
  readonly strip: StripPlan;
  readonly picker: PlanPickerToggle;
  readonly onPlanChanged: () => void;
}): React.JSX.Element | null {
  const { membership } = strip;
  const isShown =
    offersPlanChange(strip) &&
    (membership.scheduledChange !== null || picker.isOpen);
  if (!isShown) {
    return null;
  }
  return (
    <div id={picker.id}>
      <PlanChange
        translate={strip.translate}
        membership={membership}
        onChanged={onPlanChanged}
      />
    </div>
  );
}

export function PlanCard({
  translate,
  view,
  membership,
  waiting,
  returns,
  onViewReplaced,
  onPlanChanged,
}: {
  readonly translate: Translator;
  readonly view: MembershipView;
  readonly membership: MembershipPanelView;
  readonly waiting: Waiting;
  readonly returns: StripeReturns;
  /** Pagos pinta la membresía que responde la elección de plan. */
  readonly onViewReplaced: (view: MembershipView) => void;
  /** Pagos vuelve a leer la membresía cuando el cambio de plan sale bien. */
  readonly onPlanChanged: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const picker = usePlanPickerToggle();
  const strip: StripPlan = { translate, view, membership, waiting };
  const isWaiting = isWaitingForSubscription(waiting);
  return (
    <section className="payments-plan-strip" aria-labelledby={titleId}>
      <h2 id={titleId} className="visually-hidden">
        {translate("payments.plan.title")}
      </h2>
      <div className="payments-plan-row">
        <PlanOverview strip={strip} />
        <PlanButtons strip={strip} picker={picker} />
      </div>
      {isWaiting ? (
        <SubscriptionWaitStatus translate={translate} waiting={waiting} />
      ) : null}
      {isChoosingPlan(strip) ? (
        <PlanChoice
          translate={translate}
          membership={membership}
          onSaved={onViewReplaced}
        />
      ) : null}
      {membership.status === "pending" && !isWaiting ? (
        <PendingOffer
          translate={translate}
          view={view}
          membership={membership}
          checkoutReturn={returns.checkoutReturn}
        />
      ) : null}
      <PlanChangeArea
        strip={strip}
        picker={picker}
        onPlanChanged={onPlanChanged}
      />
      {membership.plan === "Casual" && view.paymentsConfigured ? (
        <SessionPackOffer
          translate={translate}
          waiting={waiting}
          packReturn={returns.packReturn}
        />
      ) : null}
    </section>
  );
}
