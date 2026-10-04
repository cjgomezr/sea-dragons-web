import {
  type Membership,
  type MembershipCard,
  type MembershipGateway,
  type MembershipPlan,
  type MembershipStatus,
  type RecurringPlan,
  type ScheduledPlanChange,
  readMembership,
} from "./membership";
import { canChoosePlan } from "./choose-plan";
import { canChangePlan } from "./plan-change";
import type { ClubPriceKey, ClubPriceReader } from "./stripe-prices";

/**
 * Lo que Pagos pinta de la membresía de quien la abre (#454, #455; RF-5 y
 * RF-7 del PRD de E12): el plan con su precio, el estado que cuenta hoy, el
 * próximo cobro, la tarjeta, la exención y el historial de pagos. Es lo que
 * sirve `GET /api/v1/membership`, leído de la base y nunca de Stripe en
 * caliente: lo que la base sabe lo escribió el webhook (#452). La excepción
 * es el precio del plan, que es el del `Price` de Stripe (#486).
 */

export const PAYMENT_STATUSES = ["paid", "failed", "pending"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Un pago del historial tal como lo guardó el webhook (`payments`). Los
 * importes son de AUD, en centavos enteros (CON-005). */
export type PaymentRecord = {
  readonly id: string;
  readonly amountCents: number;
  readonly description: string | null;
  readonly status: PaymentStatus;
  /** Nulo mientras no se cobró. */
  readonly paidAt: Date | null;
  readonly createdAt: Date;
};

export type PaymentHistoryGateway = {
  listByUserId(userId: string): Promise<readonly PaymentRecord[]>;
};

export type PaymentView = {
  readonly id: string;
  /** ISO 8601: cuándo se cobró o, si no se cobró, cuándo se registró. */
  readonly date: string;
  readonly description: string | null;
  readonly amountCents: number;
  readonly status: PaymentStatus;
};

export type MembershipWaiverView = {
  readonly reason: string;
  /** ISO 8601; sin fecha, la exención no vence. */
  readonly until: string | null;
};

export type ScheduledPlanChangeView = {
  readonly plan: MembershipPlan;
  /** ISO 8601: cuándo Stripe aplica el cambio. */
  readonly effectiveAt: string;
};

export type MembershipPanelView = {
  readonly plan: MembershipPlan | null;
  readonly status: MembershipStatus;
  /** El `unit_amount` del precio de Stripe del plan (#486). Nulo para
   * Casual, que no tiene cuota mensual (FR-065), y para Full o Student cuando
   * no se pudo leer: la pantalla dice entonces que no está disponible. */
  readonly monthlyPriceCents: number | null;
  /** ISO 8601. Que exista dice además que ya tuvo su mes de prueba. */
  readonly trialEnd: string | null;
  /** ISO 8601. Sólo lo hay mientras Stripe va a cobrar: en prueba o activa,
   * y sin un paso a Casual programado. */
  readonly nextChargeAt: string | null;
  readonly card: MembershipCard | null;
  /** Sólo la de una membresía exenta hoy. */
  readonly waiver: MembershipWaiverView | null;
  /** El cambio de plan que Stripe aplicará al acabar el periodo (#456). */
  readonly scheduledChange: ScheduledPlanChangeView | null;
  /** Si Pagos ofrece cambiar de plan (#456): la misma regla que el
   * endpoint, para que la aplicación nativa no la repita. */
  readonly canChangePlan: boolean;
  /** El precio mensual de Stripe de cada plan recurrente (#486), para que el
   * selector del cambio de plan los enseñe. Nulo el que no se pudo leer. */
  readonly planPrices: PlanPrices;
  /** Si Pagos ofrece elegir plan antes del primer pago (#479, D8): la
   * misma regla que `PUT /api/v1/membership/plan`. */
  readonly canChoosePlan: boolean;
  /** El precio de Stripe de una sesión Casual (#486), sólo para quien elige
   * plan. Nulo si no se pudo leer o no se enseña. */
  readonly casualSessionPriceCents: number | null;
  /** ISO 8601. Sólo de un socio exento con la suscripción todavía en curso:
   * eximirlo la canceló al final del periodo (#457), y ahí termina sin
   * volver a cobrar. */
  readonly subscriptionEndsAt: string | null;
};

export type PlanPrices = Readonly<Record<RecurringPlan, number | null>>;

export type MembershipView = {
  /** Sin las variables de Stripe no se ofrece Checkout (RF-9). */
  readonly paymentsConfigured: boolean;
  readonly membership: MembershipPanelView | null;
  /** Del más reciente al más antiguo (FR-068). */
  readonly payments: readonly PaymentView[];
};

export type MembershipViewGateways = {
  readonly membership: MembershipGateway;
  readonly payments: PaymentHistoryGateway;
  readonly prices: Pick<ClubPriceReader, "readPrice">;
};

const PRICE_KEY_OF: Readonly<Record<RecurringPlan, ClubPriceKey>> = {
  Full: "full",
  Student: "student",
};

function toIso(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

async function readPlanPrices(
  prices: MembershipViewGateways["prices"],
): Promise<PlanPrices> {
  const [full, student] = await Promise.all([
    prices.readPrice(PRICE_KEY_OF.Full),
    prices.readPrice(PRICE_KEY_OF.Student),
  ]);
  return { Full: full.amountCents, Student: student.amountCents };
}

const NO_PLAN_PRICES: PlanPrices = { Full: null, Student: null };

/** Sin nada que enseñar no se pregunta a Stripe: un Casual no tiene cuota
 * mensual, y si además no se le ofrece cambiar ni elegir plan, ningún precio
 * sale en su Pagos (#486). */
function showsPlanPrices(
  membership: Membership,
  paymentsConfigured: boolean,
): boolean {
  const hasMonthlyPrice =
    membership.plan !== null && membership.plan !== "Casual";
  return (
    hasMonthlyPrice ||
    canChoosePlan(membership) ||
    (paymentsConfigured && canChangePlan(membership))
  );
}

/** Los precios que enseña la membresía. La sesión Casual sólo sale en la
 * elección de plan. */
type ShownPrices = {
  readonly planPrices: PlanPrices;
  readonly casualSessionPriceCents: number | null;
};

async function readShownPrices(
  membership: Membership,
  context: {
    readonly prices: MembershipViewGateways["prices"];
    readonly paymentsConfigured: boolean;
  },
): Promise<ShownPrices> {
  const [planPrices, casualSession] = await Promise.all([
    showsPlanPrices(membership, context.paymentsConfigured)
      ? readPlanPrices(context.prices)
      : NO_PLAN_PRICES,
    canChoosePlan(membership)
      ? context.prices.readPrice("casualSession")
      : null,
  ]);
  return {
    planPrices,
    casualSessionPriceCents:
      casualSession === null ? null : casualSession.amountCents,
  };
}

function monthlyPriceOf(
  plan: MembershipPlan | null,
  planPrices: PlanPrices,
): number | null {
  return plan === null || plan === "Casual" ? null : planPrices[plan];
}

/** Stripe cobra al acabar la prueba o el periodo en curso; en cualquier otro
 * estado no hay cobro a la vista. */
function nextChargeOf(membership: Membership): Date | null {
  if (
    membership.plan === null ||
    membership.plan === "Casual" ||
    isMovingToCasual(membership.scheduledChange)
  ) {
    return null;
  }
  switch (membership.status) {
    case "trialing":
      return membership.trialEnd;
    case "active":
      return membership.currentPeriodEnd;
    default:
      return null;
  }
}

/** Pasar a Casual cancela la suscripción al final del periodo: ya no hay
 * otro cobro. */
function isMovingToCasual(change: ScheduledPlanChange | null): boolean {
  return change !== null && change.plan === "Casual";
}

function toScheduledChangeView(
  change: ScheduledPlanChange | null,
): ScheduledPlanChangeView | null {
  return change === null
    ? null
    : { plan: change.plan, effectiveAt: change.effectiveAt.toISOString() };
}

/** Hasta cuándo sigue la suscripción que la exención canceló, si sigue. */
function subscriptionEndOf(membership: Membership, now: Date): Date | null {
  const { status, stripeSubscriptionId, currentPeriodEnd } = membership;
  if (
    status !== "waived" ||
    stripeSubscriptionId === null ||
    currentPeriodEnd === null ||
    currentPeriodEnd.getTime() <= now.getTime()
  ) {
    return null;
  }
  return currentPeriodEnd;
}

function toPanelView(
  membership: Membership,
  context: {
    readonly paymentsConfigured: boolean;
    readonly shownPrices: ShownPrices;
    readonly now: Date;
  },
): MembershipPanelView {
  const { paymentsConfigured, now } = context;
  const { planPrices, casualSessionPriceCents } = context.shownPrices;
  return {
    plan: membership.plan,
    status: membership.status,
    monthlyPriceCents: monthlyPriceOf(membership.plan, planPrices),
    trialEnd: toIso(membership.trialEnd),
    nextChargeAt: toIso(nextChargeOf(membership)),
    card: membership.card,
    waiver:
      membership.status === "waived"
        ? {
            reason: membership.waiver.reason,
            until: toIso(membership.waiver.until),
          }
        : null,
    scheduledChange: toScheduledChangeView(membership.scheduledChange),
    canChangePlan: paymentsConfigured && canChangePlan(membership),
    planPrices,
    canChoosePlan: canChoosePlan(membership),
    casualSessionPriceCents,
    subscriptionEndsAt: toIso(subscriptionEndOf(membership, now)),
  };
}

function toPaymentView(payment: PaymentRecord): PaymentView {
  return {
    id: payment.id,
    date: (payment.paidAt ?? payment.createdAt).toISOString(),
    description: payment.description,
    amountCents: payment.amountCents,
    status: payment.status,
  };
}

function newestFirst(payments: readonly PaymentRecord[]): PaymentView[] {
  return payments
    .map(toPaymentView)
    .sort((first, second) => second.date.localeCompare(first.date));
}

export async function readMembershipView(
  gateways: MembershipViewGateways,
  input: {
    readonly userId: string;
    readonly now: Date;
    readonly paymentsConfigured: boolean;
  },
): Promise<MembershipView> {
  const [reading, payments] = await Promise.all([
    readMembership(gateways.membership, input),
    gateways.payments.listByUserId(input.userId),
  ]);
  return {
    paymentsConfigured: input.paymentsConfigured,
    membership:
      reading.kind === "none"
        ? null
        : toPanelView(reading.membership, {
            paymentsConfigured: input.paymentsConfigured,
            shownPrices: await readShownPrices(reading.membership, {
              prices: gateways.prices,
              paymentsConfigured: input.paymentsConfigured,
            }),
            now: input.now,
          }),
    payments: newestFirst(payments),
  };
}
