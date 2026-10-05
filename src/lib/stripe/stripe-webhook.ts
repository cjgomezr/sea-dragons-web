import type Stripe from "stripe";
import type { MembershipCard } from "@/lib/membership/membership";
import type { RenewalNoticeSender } from "./renewal-notice";
import {
  type CardSetupCompletedFacts,
  type MembershipLookup,
  type PlannableStripeEventFacts,
  type RenewalUpcomingFacts,
  type SessionPackPaidFacts,
  type SessionPackPayment,
  type StripeEventFacts,
  type StripeEventWrites,
  type StripeMembership,
  type StripePrices,
  planRenewalNotice,
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
  /** Todo o nada, como `applyEvent`: el id del evento, el pago y el crédito
   * del pack. El estado del Casual lo recalcula la base al sumar. */
  applySessionPackPayment(
    input: SessionPackPaymentToApply,
  ): Promise<"applied" | "duplicate">;
};

/** Un pack pagado (#471): el pago y las sesiones que suma al libro. */
export type SessionPackPaymentToApply = Pick<
  StripeEventToApply,
  "event" | "owner"
> & {
  readonly sessions: number;
  readonly payment: SessionPackPayment;
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
  /** El aviso de renovación (#470). No lanza: un correo que no sale no puede
   * hacer que Stripe reintente un evento ya apuntado. */
  readonly renewalNotices: RenewalNoticeSender;
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
  facts: Exclude<
    StripeEventFacts,
    { kind: "ignored" } | RenewalUpcomingFacts | SessionPackPaidFacts
  >,
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

  if (facts.kind === "renewalUpcoming") {
    return handleUpcomingRenewal({ event, facts, membership }, dependencies);
  }
  if (facts.kind === "sessionPackPaid") {
    const { userId, clubId } = membership.record;
    return gateway.applySessionPackPayment({
      event: { id: event.id, type: event.type, created: facts.created },
      owner: { userId, clubId },
      sessions: facts.sessions,
      payment: facts.payment,
    });
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

const NO_WRITES: StripeEventWrites = {
  membership: null,
  payment: null,
  warnings: [],
};

/** El evento se apunta sin escribir nada más, y sólo se avisa si entró por
 * primera vez: un repetido no manda un segundo aviso ni un segundo correo.
 * Una membresía que no se renueva no se apunta: no hay nada que repetir. */
async function handleUpcomingRenewal(
  input: {
    readonly event: Stripe.Event;
    readonly facts: RenewalUpcomingFacts;
    readonly membership: StripeMembership;
  },
  dependencies: StripeWebhookDependencies,
): Promise<StripeWebhookOutcome> {
  const { event, facts, membership } = input;
  const notice = planRenewalNotice({
    facts,
    membership,
    now: dependencies.now,
  });
  if (notice === null) {
    return "ignored";
  }
  const outcome = await dependencies.gateway.applyEvent({
    event: { id: event.id, type: event.type, created: facts.created },
    owner: { userId: notice.userId, clubId: notice.clubId },
    writes: NO_WRITES,
  });
  if (outcome === "applied") {
    await dependencies.renewalNotices.notifyUpcomingRenewal(notice);
  }
  return outcome;
}
