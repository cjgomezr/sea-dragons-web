import type Stripe from "stripe";
import { z } from "zod";
import {
  type MembershipCard,
  type MembershipRecord,
  type UnwaivedStatus,
  resolveMembership,
} from "@/lib/membership/membership";

/**
 * Qué escribe cada webhook de Stripe sobre la membresía y el historial (#452,
 * RF-7 y RF-8 del PRD de E12, D7). Puro: recibe el evento ya verificado y la
 * membresía que hay, y devuelve qué escribir. Quién lo escribe y cuándo es de
 * `stripe-webhook.ts`.
 */

/** Los `Price` de Stripe de cada plan (RF-3): vienen del entorno. */
export type StripePrices = { readonly full: string; readonly student: string };

/** Cómo encontrar la membresía de un evento. Cualquiera de los tres basta;
 * llegan los que el evento trae. */
export type MembershipLookup = {
  readonly userId: string | null;
  readonly customerId: string | null;
  readonly subscriptionId: string | null;
};

/** El método de pago llega entero o sólo como id, según cómo lo mande
 * Stripe; el id hay que pedírselo aparte. */
export type PaymentMethodReference =
  | { readonly kind: "none" }
  | { readonly kind: "id"; readonly id: string }
  | { readonly kind: "card"; readonly card: MembershipCard };

export type StripePayment = {
  readonly invoiceId: string;
  /** Centavos enteros, como los manda Stripe (CON-005). */
  readonly amountCents: number;
  readonly currency: string;
  readonly description: string | null;
  readonly status: "paid" | "failed";
  readonly paidAt: Date | null;
};

type FactsOf<Kind extends string, Extra> = {
  readonly kind: Kind;
  readonly created: Date;
  readonly lookup: MembershipLookup;
} & Extra;

/** Un Checkout sólo dice qué suscripción nació y de qué socio. Lo demás hay
 * que pedírselo a Stripe: ver `subscriptionFactsFromCheckout`. */
export type CheckoutCompletedFacts = FactsOf<
  "checkoutCompleted",
  { readonly subscriptionId: string }
>;

/** Un cambio de tarjeta (#455): Checkout en modo `setup` guardó una tarjeta
 * en el SetupIntent. Ponerla por defecto y leerla hay que pedírselo a Stripe:
 * ver `handleStripeEvent`. */
export type CardSetupCompletedFacts = FactsOf<
  "cardSetupCompleted",
  { readonly customerId: string; readonly setupIntentId: string }
>;

export type SubscriptionChangedFacts = FactsOf<
  "subscriptionChanged",
  {
    readonly customerId: string;
    readonly subscriptionId: string;
    readonly stripeStatus: string;
    readonly trialEnd: Date | null;
    readonly currentPeriodEnd: Date | null;
    readonly priceId: string | null;
    readonly paymentMethod: PaymentMethodReference;
  }
>;

export type StripeEventFacts =
  | { readonly kind: "ignored" }
  | CheckoutCompletedFacts
  | CardSetupCompletedFacts
  | SubscriptionChangedFacts
  | FactsOf<"subscriptionDeleted", Record<never, never>>
  | FactsOf<"invoiceSettled", { readonly payment: StripePayment }>;

/** Lo que el plan sabe escribir sin preguntarle nada más a Stripe. */
export type PlannableStripeEventFacts = Exclude<
  StripeEventFacts,
  { readonly kind: "ignored" } | CheckoutCompletedFacts
>;

/** La membresía tal como la ve el webhook: la fila y el `created` del último
 * evento de Stripe que movió su estado. */
export type StripeMembership = {
  readonly record: MembershipRecord;
  readonly lastStripeEventAt: Date | null;
};

/** Sólo las columnas que el evento cambia: una clave ausente no se toca. */
export type MembershipChanges = {
  readonly status?: UnwaivedStatus;
  readonly plan?: "Full" | "Student";
  readonly stripeCustomerId?: string;
  readonly stripeSubscriptionId?: string | null;
  readonly trialEnd?: Date | null;
  readonly currentPeriodEnd?: Date | null;
  readonly card?: MembershipCard;
  /** Sólo lo ponen los eventos de la suscripción, que son los que mueven el
   * estado y por tanto los que no pueden retroceder. */
  readonly stripeEventAt?: Date;
};

export type StripeEventWrites = {
  readonly membership: MembershipChanges | null;
  readonly payment: StripePayment | null;
  /** Lo que no se pudo reconocer y va al log. */
  readonly warnings: readonly string[];
};

const MILLISECONDS_PER_SECOND = 1000;

const MEMBERSHIP_STATUS_BY_STRIPE_STATUS: Readonly<
  Record<string, UnwaivedStatus>
> = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  canceled: "cancelled",
  unpaid: "cancelled",
  incomplete_expired: "cancelled",
};

const userIdSchema = z.uuid();

function fromStripeTime(seconds: number): Date {
  return new Date(seconds * MILLISECONDS_PER_SECOND);
}

function fromOptionalStripeTime(seconds: number | null): Date | null {
  return seconds === null ? null : fromStripeTime(seconds);
}

function idOf(reference: string | { readonly id: string }): string {
  return typeof reference === "string" ? reference : reference.id;
}

function optionalIdOf(
  reference: string | { readonly id: string } | null,
): string | null {
  return reference === null ? null : idOf(reference);
}

/** El socio que #454 anota en los metadatos al crear la suscripción. Si no
 * es un id, no se usa: la consulta lo rechazaría. */
function readMetadataUserId(
  metadata: Stripe.Metadata | null | undefined,
): string | null {
  const parsed = userIdSchema.safeParse(metadata?.user_id);
  return parsed.success ? parsed.data : null;
}

function readCheckoutUserId(session: Stripe.Checkout.Session): string | null {
  return userIdSchema.safeParse(session.client_reference_id).data ?? null;
}

function readCardSetupFacts(
  session: Stripe.Checkout.Session,
  created: Date,
): StripeEventFacts {
  const customerId = optionalIdOf(session.customer);
  const setupIntentId = optionalIdOf(session.setup_intent);
  if (customerId === null || setupIntentId === null) {
    return { kind: "ignored" };
  }
  return {
    kind: "cardSetupCompleted",
    created,
    lookup: {
      userId: readCheckoutUserId(session),
      customerId,
      subscriptionId: null,
    },
    customerId,
    setupIntentId,
  };
}

function readCheckoutFacts(
  session: Stripe.Checkout.Session,
  created: Date,
): StripeEventFacts {
  if (session.mode === "setup") {
    return readCardSetupFacts(session, created);
  }
  const customerId = optionalIdOf(session.customer);
  const subscriptionId = optionalIdOf(session.subscription);
  if (
    session.mode !== "subscription" ||
    customerId === null ||
    subscriptionId === null
  ) {
    return { kind: "ignored" };
  }
  return {
    kind: "checkoutCompleted",
    created,
    lookup: {
      userId: readCheckoutUserId(session),
      customerId,
      subscriptionId,
    },
    subscriptionId,
  };
}

function readPaymentMethod(
  paymentMethod: string | Stripe.PaymentMethod | null,
): PaymentMethodReference {
  if (paymentMethod === null) {
    return { kind: "none" };
  }
  if (typeof paymentMethod === "string") {
    return { kind: "id", id: paymentMethod };
  }
  const card = readCard(paymentMethod);
  return card === null ? { kind: "none" } : { kind: "card", card };
}

/** De la tarjeta, lo que se enseña y nada más (NFR-006). Un método de pago
 * que no es tarjeta no tiene nada que enseñar. */
export function readCard(
  paymentMethod: Stripe.PaymentMethod,
): MembershipCard | null {
  const { card } = paymentMethod;
  if (card === undefined) {
    return null;
  }
  return {
    brand: card.brand,
    last4: card.last4,
    expMonth: card.exp_month,
    expYear: card.exp_year,
  };
}

function subscriptionLookup(
  subscription: Stripe.Subscription,
): MembershipLookup {
  return {
    userId: readMetadataUserId(subscription.metadata),
    customerId: idOf(subscription.customer),
    subscriptionId: subscription.id,
  };
}

/** Una suscripción del club tiene un solo plan, así que un solo item. Desde
 * la API de 2025 el fin del periodo vive en el item, no en la suscripción. */
function readSubscriptionFacts(
  subscription: Stripe.Subscription,
  created: Date,
): SubscriptionChangedFacts {
  const item = subscription.items.data[0];
  return {
    kind: "subscriptionChanged",
    created,
    lookup: subscriptionLookup(subscription),
    customerId: idOf(subscription.customer),
    subscriptionId: subscription.id,
    stripeStatus: subscription.status,
    trialEnd: fromOptionalStripeTime(subscription.trial_end),
    currentPeriodEnd:
      item === undefined ? null : fromStripeTime(item.current_period_end),
    priceId: item === undefined ? null : item.price.id,
    paymentMethod: readPaymentMethod(subscription.default_payment_method),
  };
}

/**
 * Lo que dice un Checkout terminado, con la suscripción que se le pidió a
 * Stripe. Stripe suele mandar `customer.subscription.created` antes que el
 * Checkout y en paralelo: si aún no se conocía al socio, ese evento se perdió,
 * y sin esto la membresía se quedaría `pending` hasta el siguiente cambio de
 * la suscripción, un mes después. El socio sale del Checkout
 * (`client_reference_id`), que es lo único seguro de este punto.
 */
export function subscriptionFactsFromCheckout(
  checkout: CheckoutCompletedFacts,
  subscription: Stripe.Subscription,
): SubscriptionChangedFacts {
  const facts = readSubscriptionFacts(subscription, checkout.created);
  return {
    ...facts,
    lookup: {
      ...facts.lookup,
      userId: checkout.lookup.userId ?? facts.lookup.userId,
    },
  };
}

function readInvoicePayment(
  invoice: Stripe.Invoice,
  status: StripePayment["status"],
): StripePayment {
  const firstLine = invoice.lines.data[0];
  return {
    invoiceId: invoice.id,
    amountCents: status === "paid" ? invoice.amount_paid : invoice.amount_due,
    currency: invoice.currency,
    description: invoice.description ?? firstLine?.description ?? null,
    status,
    paidAt:
      status === "paid"
        ? fromOptionalStripeTime(invoice.status_transitions.paid_at)
        : null,
  };
}

function readInvoiceFacts(
  invoice: Stripe.Invoice,
  input: { readonly created: Date; readonly status: StripePayment["status"] },
): StripeEventFacts {
  const subscriptionDetails = invoice.parent?.subscription_details ?? null;
  return {
    kind: "invoiceSettled",
    created: input.created,
    lookup: {
      userId: readMetadataUserId(subscriptionDetails?.metadata),
      customerId: optionalIdOf(invoice.customer),
      subscriptionId: optionalIdOf(subscriptionDetails?.subscription ?? null),
    },
    payment: readInvoicePayment(invoice, input.status),
  };
}

/** Lo que dice el evento, sin mirar todavía la base. Cualquier tipo que no
 * mueve la membresía ni el historial se ignora (RF-8). */
export function readStripeEventFacts(event: Stripe.Event): StripeEventFacts {
  const created = fromStripeTime(event.created);
  switch (event.type) {
    case "checkout.session.completed":
      return readCheckoutFacts(event.data.object, created);
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return readSubscriptionFacts(event.data.object, created);
    case "customer.subscription.deleted":
      return {
        kind: "subscriptionDeleted",
        created,
        lookup: subscriptionLookup(event.data.object),
      };
    case "invoice.paid":
      return readInvoiceFacts(event.data.object, { created, status: "paid" });
    case "invoice.payment_failed":
      return readInvoiceFacts(event.data.object, { created, status: "failed" });
    default:
      return { kind: "ignored" };
  }
}

type PlanInput = {
  readonly facts: PlannableStripeEventFacts;
  readonly membership: StripeMembership;
  /** La tarjeta del método de pago, ya resuelta; nula si no hay ninguna. */
  readonly card: MembershipCard | null;
  readonly prices: StripePrices;
  readonly now: Date;
};

type MembershipPlanChange = {
  readonly changes: MembershipChanges;
  readonly warnings: readonly string[];
};

function planFromPrice(
  priceId: string | null,
  prices: StripePrices,
): MembershipPlanChange {
  if (priceId === prices.full) {
    return { changes: { plan: "Full" }, warnings: [] };
  }
  if (priceId === prices.student) {
    return { changes: { plan: "Student" }, warnings: [] };
  }
  return {
    changes: {},
    warnings: [`precio ${priceId ?? "(ninguno)"} sin plan: el plan no cambia`],
  };
}

/** Mientras la exención esté vigente, el estado es del Admin y no de Stripe
 * (RF-4): lo demás de Stripe se guarda igual. Vencida, vuelve a mandar la
 * suscripción. */
function statusChange(
  status: UnwaivedStatus,
  input: PlanInput,
): Pick<MembershipChanges, "status"> {
  const current = resolveMembership(input.membership.record, input.now);
  return current.status === "waived" ? {} : { status };
}

function statusFromStripe(
  stripeStatus: string,
  input: PlanInput,
): MembershipPlanChange {
  const status = MEMBERSHIP_STATUS_BY_STRIPE_STATUS[stripeStatus];
  if (status === undefined) {
    return {
      changes: {},
      warnings: [`estado ${stripeStatus} sin equivalente: el estado no cambia`],
    };
  }
  return { changes: statusChange(status, input), warnings: [] };
}

function planSubscriptionChange(
  facts: SubscriptionChangedFacts,
  input: PlanInput,
): MembershipPlanChange {
  const status = statusFromStripe(facts.stripeStatus, input);
  const plan = planFromPrice(facts.priceId, input.prices);
  return {
    changes: {
      ...status.changes,
      ...plan.changes,
      stripeCustomerId: facts.customerId,
      stripeSubscriptionId: facts.subscriptionId,
      trialEnd: facts.trialEnd,
      currentPeriodEnd: facts.currentPeriodEnd,
      ...(input.card === null ? {} : { card: input.card }),
      stripeEventAt: facts.created,
    },
    warnings: [...status.warnings, ...plan.warnings],
  };
}

function planMembershipChange(input: PlanInput): MembershipPlanChange | null {
  const { facts } = input;
  switch (facts.kind) {
    case "subscriptionChanged":
      return planSubscriptionChange(facts, input);
    case "subscriptionDeleted":
      return {
        changes: {
          ...statusChange("cancelled", input),
          stripeSubscriptionId: null,
          stripeEventAt: facts.created,
        },
        warnings: [],
      };
    case "cardSetupCompleted":
      // Sin `stripeEventAt`: la tarjeta no mueve el estado.
      return input.card === null
        ? null
        : { changes: { card: input.card }, warnings: [] };
    case "invoiceSettled":
      return null;
  }
}

/** Stripe no garantiza el orden: un evento anterior al último que movió la
 * membresía llega tarde y no la toca. Del mismo segundo sí, porque Stripe
 * emite varios a la vez y sólo tiene segundos. */
function isOlderThanLastApplied(input: PlanInput): boolean {
  const { lastStripeEventAt } = input.membership;
  return (
    lastStripeEventAt !== null &&
    input.facts.created.getTime() < lastStripeEventAt.getTime()
  );
}

export function planStripeEventWrites(input: PlanInput): StripeEventWrites {
  const payment =
    input.facts.kind === "invoiceSettled" ? input.facts.payment : null;
  const change = planMembershipChange(input);
  if (change === null || isOlderThanLastApplied(input)) {
    return { membership: null, payment, warnings: [] };
  }
  return { membership: change.changes, payment, warnings: change.warnings };
}
