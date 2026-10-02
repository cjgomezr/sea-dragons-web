import type Stripe from "stripe";
import {
  type CheckoutSessions,
  buildPaymentsReturnUrl,
  idempotencyKeyFor,
} from "./checkout";
import { CARD_RETURN_QUERY_PARAM } from "./checkout-return";
import { type MembershipGateway, readMembership } from "./membership";

/**
 * Cambiar la tarjeta (#455, RF-5 del PRD de E12, D6): una sesión de Stripe
 * Checkout en modo `setup` para el cliente de Stripe del socio. La tarjeta se
 * escribe en Stripe y nunca pasa por la aplicación (FR-067, AC-029). Cuando
 * Stripe confirma, el webhook (#452) la pone por defecto en la suscripción y
 * la guarda en la membresía.
 */

export type CardUpdateStripe =
  | { readonly kind: "configured"; readonly sessions: CheckoutSessions }
  | { readonly kind: "unconfigured" };

export type CardUpdateGateways = {
  readonly membership: MembershipGateway;
  readonly stripe: CardUpdateStripe;
};

/** Sin cliente en Stripe no hay tarjeta que cambiar: quien no la puso nunca
 * la pone por el alta de Checkout (#454). */
export type CardUpdateRefusal = "stripe_not_configured" | "no_stripe_customer";

export type CardUpdateStart =
  | { readonly kind: "created"; readonly url: string }
  | { readonly kind: "refused"; readonly reason: CardUpdateRefusal };

export type CardUpdateRequest = {
  readonly userId: string;
  /** El origen de la petición, para volver a Pagos en cualquier entorno. */
  readonly origin: string;
  readonly now: Date;
};

/** La moneda del club (FR-062): la de las cuotas que cobrará la tarjeta. */
const CLUB_CURRENCY = "aud";

function buildSetupSessionParams(
  customerId: string,
  request: CardUpdateRequest,
): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "setup",
    customer: customerId,
    // Sin `payment_method_types` (fuera del SDK), Stripe pide la moneda en
    // modo `setup`. Sólo tarjeta: es lo único que la membresía sabe enseñar.
    currency: CLUB_CURRENCY,
    allowed_payment_method_types: ["card"],
    client_reference_id: request.userId,
    setup_intent_data: { metadata: { user_id: request.userId } },
    success_url: buildPaymentsReturnUrl(
      request.origin,
      CARD_RETURN_QUERY_PARAM,
      "ok",
    ),
    cancel_url: buildPaymentsReturnUrl(
      request.origin,
      CARD_RETURN_QUERY_PARAM,
      "cancelado",
    ),
  };
}

export async function startCardUpdate(
  gateways: CardUpdateGateways,
  request: CardUpdateRequest,
): Promise<CardUpdateStart> {
  const { stripe } = gateways;
  if (stripe.kind === "unconfigured") {
    return { kind: "refused", reason: "stripe_not_configured" };
  }
  const reading = await readMembership(gateways.membership, request);
  const customerId =
    reading.kind === "found" ? reading.membership.stripeCustomerId : null;
  if (customerId === null) {
    return { kind: "refused", reason: "no_stripe_customer" };
  }
  const params = buildSetupSessionParams(customerId, request);
  const session = await stripe.sessions.create(params, {
    idempotencyKey: idempotencyKeyFor(params, request.now),
  });
  if (session.url === null) {
    throw new Error(
      `Stripe creó la sesión para cambiar la tarjeta de ${request.userId} sin dirección.`,
    );
  }
  return { kind: "created", url: session.url };
}
