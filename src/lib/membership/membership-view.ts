import {
  MONTHLY_PRICE_CENTS,
  type Membership,
  type MembershipCard,
  type MembershipGateway,
  type MembershipPlan,
  type MembershipStatus,
  readMembership,
} from "./membership";

/**
 * Lo que Pagos pinta de la membresía de quien la abre (#454, #455; RF-5 y
 * RF-7 del PRD de E12): el plan con su precio, el estado que cuenta hoy, el
 * próximo cobro, la tarjeta, la exención y el historial de pagos. Es lo que
 * sirve `GET /api/v1/membership`, leído de la base y nunca de Stripe en
 * caliente: lo que la base sabe lo escribió el webhook (#452).
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

export type MembershipPanelView = {
  readonly plan: MembershipPlan | null;
  readonly status: MembershipStatus;
  /** Nulo para Casual, que no tiene cuota mensual (FR-065). */
  readonly monthlyPriceCents: number | null;
  /** ISO 8601. Que exista dice además que ya tuvo su mes de prueba. */
  readonly trialEnd: string | null;
  /** ISO 8601. Sólo lo hay mientras Stripe va a cobrar: en prueba o activa. */
  readonly nextChargeAt: string | null;
  readonly card: MembershipCard | null;
  /** Sólo la de una membresía exenta hoy. */
  readonly waiver: MembershipWaiverView | null;
};

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
};

function toIso(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

function monthlyPriceOf(plan: MembershipPlan | null): number | null {
  return plan === null || plan === "Casual" ? null : MONTHLY_PRICE_CENTS[plan];
}

/** Stripe cobra al acabar la prueba o el periodo en curso; en cualquier otro
 * estado no hay cobro a la vista. */
function nextChargeOf(membership: Membership): Date | null {
  if (membership.plan === null || membership.plan === "Casual") {
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

function toPanelView(membership: Membership): MembershipPanelView {
  return {
    plan: membership.plan,
    status: membership.status,
    monthlyPriceCents: monthlyPriceOf(membership.plan),
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
      reading.kind === "none" ? null : toPanelView(reading.membership),
    payments: newestFirst(payments),
  };
}
