import type { StripePrices } from "@/lib/stripe/webhook-events";
import {
  type CheckoutSessions,
  type MemberEmailGateway,
  type SubscriptionCheckoutContext,
  openSubscriptionCheckout,
} from "./checkout";
import {
  type Membership,
  type MembershipGateway,
  type MembershipPlan,
  type RecurringPlan,
  type ScheduledPlanChange,
  readMembership,
} from "./membership";

/**
 * El cambio de plan al siguiente ciclo (#456, RF-6 del PRD de E12, FR-066,
 * D5). Entre Full y Student, Stripe cambia el precio cuando acaba el periodo
 * en curso, sin prorrateo; a Casual, la suscripción se cancela ese mismo día.
 * Un Casual que elige Full o Student va a Checkout como en el alta (#454).
 *
 * El cambio se guarda en la membresía para que Pagos lo enseñe sin preguntar
 * a Stripe. Cuando Stripe lo aplica, el webhook (#452) pone el plan nuevo y
 * lo borra.
 */

/** Lo que se le pide a la suscripción de Stripe. Lo cumple
 * `createSubscriptionPlanApi` de `stripe-client.ts`. */
export type SubscriptionPlanApi = {
  /** Cambia el precio al acabar el periodo en curso. Devuelve cuándo. */
  schedulePriceChange(input: {
    readonly subscriptionId: string;
    readonly priceId: string;
  }): Promise<Date>;
  /** Deja la suscripción con el precio que tiene ahora. */
  cancelPriceChange(subscriptionId: string): Promise<void>;
  /** Cancela al acabar el periodo en curso. Devuelve cuándo. */
  cancelAtPeriodEnd(subscriptionId: string): Promise<Date>;
  /** Deshace `cancelAtPeriodEnd`: la suscripción sigue. */
  resumeSubscription(subscriptionId: string): Promise<void>;
};

export type ScheduledPlanChangeGateway = {
  saveScheduledChange(
    userId: string,
    change: ScheduledPlanChange | null,
  ): Promise<void>;
};

export type PlanChangeStripe =
  | {
      readonly kind: "configured";
      readonly prices: StripePrices;
      readonly subscriptions: SubscriptionPlanApi;
      readonly sessions: CheckoutSessions;
    }
  | { readonly kind: "unconfigured" };

export type PlanChangeGateways = {
  readonly membership: MembershipGateway;
  readonly scheduledChanges: ScheduledPlanChangeGateway;
  readonly memberEmails: MemberEmailGateway;
  readonly stripe: PlanChangeStripe;
};

/** Por qué una membresía no puede cambiar de plan, sin mirar el plan pedido. */
export type PlanChangeIneligibility =
  | "no_plan"
  | "membership_waived"
  | "membership_not_current"
  | "no_subscription";

export type PlanChangeRefusal =
  | PlanChangeIneligibility
  | "stripe_not_configured"
  | "same_plan"
  | "change_already_scheduled";

export type PlanChangeOutcome =
  | { readonly kind: "scheduled"; readonly change: ScheduledPlanChange }
  | { readonly kind: "checkout"; readonly url: string }
  | { readonly kind: "refused"; readonly reason: PlanChangeRefusal };

export type PlanChangeCancellationRefusal =
  "stripe_not_configured" | "no_scheduled_change";

export type PlanChangeCancellation =
  | { readonly kind: "cancelled" }
  | {
      readonly kind: "refused";
      readonly reason: PlanChangeCancellationRefusal;
    };

export type PlanChangeRequest = {
  readonly userId: string;
  readonly plan: MembershipPlan;
  /** El origen de la petición, para volver de Checkout en cualquier entorno. */
  readonly origin: string;
  readonly now: Date;
};

/** Cómo cambia de plan una membresía: su suscripción de Stripe, o Checkout
 * si es Casual y no tiene ninguna. */
type PlanChangeRoute =
  | {
      readonly kind: "subscription";
      readonly subscriptionId: string;
      readonly membership: Membership;
    }
  | { readonly kind: "checkout"; readonly membership: Membership };

/** La exención va antes que Casual: quien no paga no tiene nada que cambiar
 * hasta que se la retiren. */
function routePlanChange(
  membership: Membership | null,
): PlanChangeRoute | PlanChangeIneligibility {
  if (membership === null || membership.plan === null) {
    return "no_plan";
  }
  if (membership.status === "waived") {
    return "membership_waived";
  }
  if (membership.plan === "Casual") {
    return { kind: "checkout", membership };
  }
  if (membership.status !== "active" && membership.status !== "trialing") {
    return "membership_not_current";
  }
  if (membership.stripeSubscriptionId === null) {
    return "no_subscription";
  }
  return {
    kind: "subscription",
    subscriptionId: membership.stripeSubscriptionId,
    membership,
  };
}

/** Si Pagos debe ofrecer el cambio de plan a esta membresía. */
export function canChangePlan(membership: Membership): boolean {
  return typeof routePlanChange(membership) !== "string";
}

function priceOf(plan: RecurringPlan, prices: StripePrices): string {
  return plan === "Full" ? prices.full : prices.student;
}

type ConfiguredStripe = Extract<PlanChangeStripe, { kind: "configured" }>;

async function scheduleOnSubscription(
  subscriptionId: string,
  plan: MembershipPlan,
  stripe: ConfiguredStripe,
): Promise<Date> {
  if (plan === "Casual") {
    return stripe.subscriptions.cancelAtPeriodEnd(subscriptionId);
  }
  return stripe.subscriptions.schedulePriceChange({
    subscriptionId,
    priceId: priceOf(plan, stripe.prices),
  });
}

/** Un mismo cambio repetido (un doble toque, un reintento) devuelve el que
 * ya hay sin volver a Stripe. Otro distinto pide anular el primero. */
async function changeSubscriptionPlan(
  route: Extract<PlanChangeRoute, { kind: "subscription" }>,
  gateways: PlanChangeGateways & { readonly stripe: ConfiguredStripe },
  request: PlanChangeRequest,
): Promise<PlanChangeOutcome> {
  const { scheduledChange } = route.membership;
  if (scheduledChange !== null) {
    return scheduledChange.plan === request.plan
      ? { kind: "scheduled", change: scheduledChange }
      : { kind: "refused", reason: "change_already_scheduled" };
  }
  const effectiveAt = await scheduleOnSubscription(
    route.subscriptionId,
    request.plan,
    gateways.stripe,
  );
  const change = { plan: request.plan, effectiveAt };
  await gateways.scheduledChanges.saveScheduledChange(request.userId, change);
  return { kind: "scheduled", change };
}

export async function requestPlanChange(
  gateways: PlanChangeGateways,
  request: PlanChangeRequest,
): Promise<PlanChangeOutcome> {
  const { stripe } = gateways;
  if (stripe.kind === "unconfigured") {
    return { kind: "refused", reason: "stripe_not_configured" };
  }
  const reading = await readMembership(gateways.membership, request);
  const route = routePlanChange(
    reading.kind === "found" ? reading.membership : null,
  );
  if (typeof route === "string") {
    return { kind: "refused", reason: route };
  }
  if (route.kind === "checkout") {
    return checkoutFromCasual(route.membership, request.plan, {
      stripe,
      memberEmails: gateways.memberEmails,
      request,
    });
  }
  if (route.membership.plan === request.plan) {
    return { kind: "refused", reason: "same_plan" };
  }
  return changeSubscriptionPlan(route, { ...gateways, stripe }, request);
}

/** Sólo un Casual llega a Checkout por aquí: pedir Casual es pedir el plan
 * que ya tiene. Sin prueba si ya tuvo una, como en el alta. */
async function checkoutFromCasual(
  membership: Membership,
  plan: MembershipPlan,
  context: SubscriptionCheckoutContext,
): Promise<PlanChangeOutcome> {
  if (plan === "Casual") {
    return { kind: "refused", reason: "same_plan" };
  }
  const url = await openSubscriptionCheckout({ membership, plan }, context);
  return { kind: "checkout", url };
}

export async function cancelPlanChange(
  gateways: PlanChangeGateways,
  request: { readonly userId: string; readonly now: Date },
): Promise<PlanChangeCancellation> {
  const { stripe } = gateways;
  if (stripe.kind === "unconfigured") {
    return { kind: "refused", reason: "stripe_not_configured" };
  }
  const reading = await readMembership(gateways.membership, request);
  const membership = reading.kind === "found" ? reading.membership : null;
  if (
    membership === null ||
    membership.scheduledChange === null ||
    membership.stripeSubscriptionId === null
  ) {
    return { kind: "refused", reason: "no_scheduled_change" };
  }
  const subscriptionId = membership.stripeSubscriptionId;
  if (membership.scheduledChange.plan === "Casual") {
    await stripe.subscriptions.resumeSubscription(subscriptionId);
  } else {
    await stripe.subscriptions.cancelPriceChange(subscriptionId);
  }
  await gateways.scheduledChanges.saveScheduledChange(request.userId, null);
  return { kind: "cancelled" };
}
