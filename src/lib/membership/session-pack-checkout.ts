import type Stripe from "stripe";
import {
  type CheckoutRequest,
  type CheckoutSessions,
  type MemberEmailGateway,
  buildCustomerParams,
  buildPaymentsReturnUrl,
  idempotencyKeyFor,
} from "./checkout";
import { PACK_RETURN_QUERY_PARAM } from "./checkout-return";
import {
  type Membership,
  type MembershipGateway,
  readMembership,
} from "./membership";

/**
 * La compra de un pack de sesiones en Stripe Checkout (#471, RF-5 del PRD de
 * E13, D1 y D2). Un Casual paga una vez tantas sesiones como trae el pack, al
 * precio de la sesión Casual de Stripe. Aquí no se escribe nada: el saldo lo
 * suma el webhook cuando Stripe confirma el pago, y con él se abre la puerta.
 */

/** Lo que el webhook busca en los metadatos para reconocer un pack. */
export const SESSION_PACK_METADATA_KIND = "session_pack";

export type SessionPackCheckoutStripe =
  | {
      readonly kind: "configured";
      /** El id del `Price` de pago único de una sesión Casual. */
      readonly casualSessionPrice: string;
      readonly sessions: CheckoutSessions;
    }
  | { readonly kind: "unconfigured" };

export type SessionPackCheckoutGateways = {
  readonly membership: MembershipGateway;
  readonly memberEmails: MemberEmailGateway;
  readonly packSizes: {
    /** Los tamaños que el club ofrece (#469). */
    findPackSizes(clubId: string): Promise<readonly number[]>;
  };
  readonly stripe: SessionPackCheckoutStripe;
};

export type SessionPackCheckoutRequest = CheckoutRequest & {
  readonly sessions: number;
};

/** Por qué no se abre Checkout. Sin membresía tampoco se es Casual. */
export type SessionPackCheckoutRefusal =
  "stripe_not_configured" | "not_casual" | "pack_not_offered";

export type SessionPackCheckoutStart =
  | { readonly kind: "created"; readonly url: string }
  | { readonly kind: "refused"; readonly reason: SessionPackCheckoutRefusal };

async function buildSessionParams(
  membership: Membership,
  context: {
    readonly casualSessionPrice: string;
    readonly memberEmails: MemberEmailGateway;
    readonly request: SessionPackCheckoutRequest;
  },
): Promise<Stripe.Checkout.SessionCreateParams> {
  const { request } = context;
  return {
    mode: "payment",
    line_items: [
      { price: context.casualSessionPrice, quantity: request.sessions },
    ],
    client_reference_id: membership.userId,
    ...(await buildCustomerParams(membership, context.memberEmails)),
    metadata: {
      user_id: membership.userId,
      kind: SESSION_PACK_METADATA_KIND,
      pack_sessions: String(request.sessions),
    },
    success_url: buildPaymentsReturnUrl(
      request.origin,
      PACK_RETURN_QUERY_PARAM,
      "ok",
    ),
    cancel_url: buildPaymentsReturnUrl(
      request.origin,
      PACK_RETURN_QUERY_PARAM,
      "cancelado",
    ),
  };
}

export async function startSessionPackCheckout(
  gateways: SessionPackCheckoutGateways,
  request: SessionPackCheckoutRequest,
): Promise<SessionPackCheckoutStart> {
  const { stripe } = gateways;
  if (stripe.kind === "unconfigured") {
    return { kind: "refused", reason: "stripe_not_configured" };
  }
  const reading = await readMembership(gateways.membership, request);
  if (reading.kind !== "found" || reading.membership.plan !== "Casual") {
    return { kind: "refused", reason: "not_casual" };
  }
  const { membership } = reading;
  const offered = await gateways.packSizes.findPackSizes(membership.clubId);
  if (!offered.includes(request.sessions)) {
    return { kind: "refused", reason: "pack_not_offered" };
  }
  const params = await buildSessionParams(membership, {
    casualSessionPrice: stripe.casualSessionPrice,
    memberEmails: gateways.memberEmails,
    request,
  });
  const session = await stripe.sessions.create(params, {
    idempotencyKey: idempotencyKeyFor(params, request.now),
  });
  if (session.url === null) {
    throw new Error(
      `Stripe creó la sesión de Checkout del pack de ${request.userId} sin dirección.`,
    );
  }
  return { kind: "created", url: session.url };
}
