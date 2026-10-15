import type Stripe from "stripe";
import type { MembershipCard } from "@/lib/membership/membership";
import type { RenewalNoticeSender } from "./renewal-notice";
import {
  type CardSetupCompletedFacts,
  type ChargeCard,
  type ChargeDetails,
  type LevyPaidFacts,
  type LevyPayment,
  type LevyQuantity,
  type MembershipLookup,
  type PlannableStripeEventFacts,
  type RenewalUpcomingFacts,
  type SessionPackPaidFacts,
  type SessionPackPayment,
  type StripeEventFacts,
  type StripeEventWrites,
  type StripeMembership,
  type StripePrices,
  NO_CHARGE_DETAILS,
  planRenewalNotice,
  planStripeEventWrites,
  readStripeEventFacts,
  subscriptionFactsFromCheckout,
} from "./webhook-events";
import { SINGLE_UNIT } from "./product-catalog";

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
  /** Todo o nada, como `applyEvent`: el id del evento y el pago del levy,
   * con su producto. La membresía no cambia (D4). */
  applyLevyPayment(input: LevyPaymentToApply): Promise<"applied" | "duplicate">;
  /** El club de la ficha del socio. Un levy no exige membresía (D4), así
   * que su dueño sale de aquí y no de `findMembership`. */
  findMemberClubId(userId: string): Promise<string | null>;
};

/** Un pack pagado (#471): el pago y las sesiones que suma al libro. */
export type SessionPackPaymentToApply = Pick<
  StripeEventToApply,
  "event" | "owner"
> & {
  readonly sessions: number;
  readonly payment: SessionPackPayment;
  /** Nula si el cobro no fue con tarjeta o no se pudo leer (#629). */
  readonly card: ChargeCard | null;
};

/** Un levy pagado (#473): el pago con el producto de Stripe. */
export type LevyPaymentToApply = Pick<StripeEventToApply, "event" | "owner"> & {
  readonly payment: LevyPayment;
  /** Las unidades que se pagaron (#632): una, salvo un extra de varias. */
  readonly quantity: number;
  /** Nula si el cobro no fue con tarjeta o no se pudo leer (#629). */
  readonly card: ChargeCard | null;
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
  /** El cobro de una factura (#629): ni la factura lo trae. */
  readInvoiceCharge(invoiceId: string): Promise<ChargeDetails>;
  /** El cobro de un pago suelto, un pack o un levy (#629). */
  readPaymentCharge(paymentIntentId: string): Promise<ChargeDetails>;
  /** Las unidades que el socio eligió en un Checkout (#632): el evento no
   * trae las líneas de la sesión. */
  readCheckoutQuantity(checkoutSessionId: string): Promise<number>;
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
    | { kind: "ignored" }
    | RenewalUpcomingFacts
    | SessionPackPaidFacts
    | LevyPaidFacts
  >,
  stripe: StripeApi,
): Promise<PlannableStripeEventFacts> {
  if (facts.kind !== "checkoutCompleted") {
    return facts;
  }
  const subscription = await stripe.readSubscription(facts.subscriptionId);
  return subscriptionFactsFromCheckout(facts, subscription);
}

/** La tarjeta y el motivo son para enseñar, no para apuntar el pago: si
 * Stripe no los da, el pago se guarda sin ellos y el evento no se pierde. */
async function readChargeOrNothing(
  read: () => Promise<ChargeDetails>,
  context: {
    readonly event: Stripe.Event;
    readonly log: (line: string) => void;
  },
): Promise<ChargeDetails> {
  try {
    return await read();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    context.log(
      `${LOG_PREFIX} ${context.event.id} (${context.event.type}): no se pudo leer el cobro en Stripe, el pago se guarda sin tarjeta: ${reason}`,
    );
    return NO_CHARGE_DETAILS;
  }
}

function readInvoiceChargeOf(
  facts: PlannableStripeEventFacts,
  context: {
    readonly event: Stripe.Event;
    readonly dependencies: StripeWebhookDependencies;
  },
): Promise<ChargeDetails> {
  if (facts.kind !== "invoiceSettled") {
    return Promise.resolve(NO_CHARGE_DETAILS);
  }
  const { stripe, log } = context.dependencies;
  return readChargeOrNothing(
    () => stripe.readInvoiceCharge(facts.payment.invoiceId),
    { event: context.event, log },
  );
}

async function readPaymentCardOf(
  paymentIntentId: string,
  context: {
    readonly event: Stripe.Event;
    readonly dependencies: StripeWebhookDependencies;
  },
): Promise<ChargeCard | null> {
  const { stripe, log } = context.dependencies;
  const charge = await readChargeOrNothing(
    () => stripe.readPaymentCharge(paymentIntentId),
    { event: context.event, log },
  );
  return charge.card;
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

  if (facts.kind === "levyPaid") {
    return handleLevyPayment({ event, facts }, dependencies);
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
      card: await readPaymentCardOf(facts.payment.paymentIntentId, {
        event,
        dependencies,
      }),
    });
  }

  const plannable = await toPlannableFacts(facts, dependencies.stripe);
  const writes = planStripeEventWrites({
    facts: plannable,
    membership,
    card: await resolveCard(plannable, membership, dependencies.stripe),
    charge: await readInvoiceChargeOf(plannable, { event, dependencies }),
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

/** A diferencia de la tarjeta, las unidades no se pueden dejar sin leer: un
 * extra de tres apuntado como uno contaría mal lo que lleva comprado el
 * socio. Si Stripe no responde, el error hace que reintente el evento. */
function readLevyQuantityOf(
  quantity: LevyQuantity,
  stripe: StripeApi,
): Promise<number> {
  return quantity.kind === "single"
    ? Promise.resolve(SINGLE_UNIT)
    : stripe.readCheckoutQuantity(quantity.checkoutSessionId);
}

/** Quien paga un levy puede no tener membresía todavía (D4): basta con que
 * sea socio del club. */
async function handleLevyPayment(
  input: { readonly event: Stripe.Event; readonly facts: LevyPaidFacts },
  dependencies: StripeWebhookDependencies,
): Promise<StripeWebhookOutcome> {
  const { event, facts } = input;
  const { gateway, log } = dependencies;
  const { userId } = facts.lookup;
  const clubId =
    userId === null ? null : await gateway.findMemberClubId(userId);
  if (userId === null || clubId === null) {
    log(
      `${LOG_PREFIX} ${event.id} (${event.type}) no es de ningún socio conocido: ${describeLookup(facts.lookup)}`,
    );
    return "unknown_member";
  }
  return gateway.applyLevyPayment({
    event: { id: event.id, type: event.type, created: facts.created },
    owner: { userId, clubId },
    payment: facts.payment,
    quantity: await readLevyQuantityOf(facts.quantity, dependencies.stripe),
    card: await readPaymentCardOf(facts.payment.paymentIntentId, {
      event,
      dependencies,
    }),
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
