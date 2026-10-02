import type Stripe from "stripe";
import type { MembershipCard } from "@/lib/membership/membership";
import {
  type CardSetupCompletedFacts,
  type MembershipLookup,
  type PlannableStripeEventFacts,
  type StripeEventFacts,
  type StripeEventWrites,
  type StripeMembership,
  type StripePrices,
  planStripeEventWrites,
  readStripeEventFacts,
  subscriptionFactsFromCheckout,
} from "./webhook-events";

/**
 * Aplicar un evento de Stripe ya verificado (#452, RF-8 del PRD de E12): se
 * busca la membresía, se le pregunta a Stripe lo que el evento no trae y se
 * escribe todo de una vez, con el id del evento delante para que un repetido
 * no se aplique dos veces.
 */

export type StripeWebhookOutcome =
  "applied" | "duplicate" | "ignored" | "unknown_member";

export type StripeEventToApply = {
  readonly event: {
    readonly id: string;
    readonly type: string;
    readonly created: Date;
  };
  readonly owner: { readonly userId: string; readonly clubId: string };
  readonly writes: StripeEventWrites;
};

export type StripeWebhookGateway = {
  findMembership(lookup: MembershipLookup): Promise<StripeMembership | null>;
  /** Todo o nada: el id del evento, la membresía y el pago. `duplicate` si
   * el id ya estaba, sin escribir nada más. */
  applyEvent(input: StripeEventToApply): Promise<"applied" | "duplicate">;
};

/** La tarjeta que guardó un SetupIntent, con el id de su método de pago. */
export type SetupCard = {
  readonly paymentMethodId: string;
  readonly card: MembershipCard;
};

/** Lo que el webhook le pide a Stripe cuando el evento no lo trae, y lo
 * único que le escribe: la tarjeta nueva de un cambio de tarjeta (#455). */
export type StripeApi = {
  readCard(paymentMethodId: string): Promise<MembershipCard | null>;
  readSubscription(subscriptionId: string): Promise<Stripe.Subscription>;
  /** Nula si el SetupIntent no guardó una tarjeta. */
  readSetupCard(setupIntentId: string): Promise<SetupCard | null>;
  /** Por defecto en el cliente y, si la tiene, en la suscripción: es con la
   * que Stripe cobra la próxima cuota y reintenta la fallida. */
  makeDefaultPaymentMethod(input: {
    readonly customerId: string;
    readonly subscriptionId: string | null;
    readonly paymentMethodId: string;
  }): Promise<void>;
};

export type StripeWebhookDependencies = {
  readonly gateway: StripeWebhookGateway;
  readonly stripe: StripeApi;
  readonly prices: StripePrices;
  readonly now: Date;
  readonly log: (line: string) => void;
};

const LOG_PREFIX = "[stripe/webhook]";

/** La tarjeta de un cambio de tarjeta, puesta ya por defecto en Stripe.
 * Repetir el evento la vuelve a poner, que no cambia nada. */
async function adoptSetupCard(
  facts: CardSetupCompletedFacts,
  membership: StripeMembership,
  stripe: StripeApi,
): Promise<MembershipCard | null> {
  const setup = await stripe.readSetupCard(facts.setupIntentId);
  if (setup === null) {
    return null;
  }
  await stripe.makeDefaultPaymentMethod({
    customerId: facts.customerId,
    subscriptionId: membership.record.stripeSubscriptionId,
    paymentMethodId: setup.paymentMethodId,
  });
  return setup.card;
}

async function resolveCard(
  facts: PlannableStripeEventFacts,
  membership: StripeMembership,
  stripe: StripeApi,
): Promise<MembershipCard | null> {
  if (facts.kind === "cardSetupCompleted") {
    return adoptSetupCard(facts, membership, stripe);
  }
  if (facts.kind !== "subscriptionChanged") {
    return null;
  }
  const { paymentMethod } = facts;
  switch (paymentMethod.kind) {
    case "none":
      return null;
    case "card":
      return paymentMethod.card;
    case "id":
      return stripe.readCard(paymentMethod.id);
  }
}

/** Un Checkout sólo nombra la suscripción: se le pide entera a Stripe. */
async function toPlannableFacts(
  facts: Exclude<StripeEventFacts, { kind: "ignored" }>,
  stripe: StripeApi,
): Promise<PlannableStripeEventFacts> {
  if (facts.kind !== "checkoutCompleted") {
    return facts;
  }
  const subscription = await stripe.readSubscription(facts.subscriptionId);
  return subscriptionFactsFromCheckout(facts, subscription);
}

function describeLookup(lookup: MembershipLookup): string {
  return `socio ${lookup.userId ?? "-"}, cliente ${lookup.customerId ?? "-"}, suscripción ${lookup.subscriptionId ?? "-"}`;
}

export async function handleStripeEvent(
  event: Stripe.Event,
  dependencies: StripeWebhookDependencies,
): Promise<StripeWebhookOutcome> {
  const facts = readStripeEventFacts(event);
  if (facts.kind === "ignored") {
    return "ignored";
  }

  const { gateway, log } = dependencies;
  const membership = await gateway.findMembership(facts.lookup);
  if (membership === null) {
    log(
      `${LOG_PREFIX} ${event.id} (${event.type}) no es de ningún socio conocido: ${describeLookup(facts.lookup)}`,
    );
    return "unknown_member";
  }

  const plannable = await toPlannableFacts(facts, dependencies.stripe);
  const writes = planStripeEventWrites({
    facts: plannable,
    membership,
    card: await resolveCard(plannable, membership, dependencies.stripe),
    prices: dependencies.prices,
    now: dependencies.now,
  });
  for (const warning of writes.warnings) {
    log(`${LOG_PREFIX} ${event.id} (${event.type}): ${warning}`);
  }

  const { userId, clubId } = membership.record;
  return gateway.applyEvent({
    event: { id: event.id, type: event.type, created: facts.created },
    owner: { userId, clubId },
    writes,
  });
}
