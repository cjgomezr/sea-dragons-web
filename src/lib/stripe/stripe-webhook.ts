import type Stripe from "stripe";
import type { MembershipCard } from "@/lib/membership/membership";
import {
  type AppliedStripeEventFacts,
  type MembershipLookup,
  type StripeEventWrites,
  type StripeMembership,
  type StripePrices,
  planStripeEventWrites,
  readStripeEventFacts,
} from "./webhook-events";

/**
 * Aplicar un evento de Stripe ya verificado (#452, RF-8 del PRD de E12): se
 * busca la membresía, se resuelve la tarjeta y se escribe todo de una vez,
 * con el id del evento delante para que un repetido no se aplique dos veces.
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

export type StripeCardReader = {
  readCard(paymentMethodId: string): Promise<MembershipCard | null>;
};

export type StripeWebhookDependencies = {
  readonly gateway: StripeWebhookGateway;
  readonly cards: StripeCardReader;
  readonly prices: StripePrices;
  readonly now: Date;
  readonly log: (line: string) => void;
};

const LOG_PREFIX = "[stripe/webhook]";

async function resolveCard(
  facts: AppliedStripeEventFacts,
  cards: StripeCardReader,
): Promise<MembershipCard | null> {
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
      return cards.readCard(paymentMethod.id);
  }
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

  const writes = planStripeEventWrites({
    facts,
    membership,
    card: await resolveCard(facts, dependencies.cards),
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
