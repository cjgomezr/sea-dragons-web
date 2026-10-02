import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { PAYMENTS_PATH } from "@/lib/auth/routes";
import type { StripePrices } from "@/lib/stripe/webhook-events";
import {
  CHECKOUT_RETURN_QUERY_PARAM,
  type CheckoutReturn,
} from "./checkout-return";
import {
  type Membership,
  type MembershipGateway,
  type RecurringPlan,
  isMembershipCurrent,
  readMembership,
} from "./membership";

/**
 * El alta en Stripe Checkout (#454, RF-3 del PRD de E12, D3): el socio Full o
 * Student pone la tarjeta en Stripe, con un mes de prueba la primera vez. Aquí
 * no se escribe nada: la membresía la mueve el webhook (#452) cuando Stripe
 * confirma, y si el socio abandona, sigue como estaba.
 */

/** El mes de prueba de D3: el primer cobro es el día 31. */
export const TRIAL_PERIOD_DAYS = 30;

/** Un doble toque llega dentro de esta ventana y recibe la misma sesión:
 * Stripe devuelve la respuesta guardada para una misma llave de idempotencia.
 * Pasada la ventana, un nuevo intento abre otra. Stripe guarda también los
 * errores 4xx: un precio mal configurado y corregido sigue fallando hasta que
 * la ventana cambia. */
export const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;

/** Lo único que se le pide al SDK de Stripe. `client.checkout.sessions` lo
 * cumple tal cual. */
export type CheckoutSessions = {
  create(
    params: Stripe.Checkout.SessionCreateParams,
    options: { readonly idempotencyKey: string },
  ): Promise<{ readonly url: string | null }>;
};

export type CheckoutStripe =
  | {
      readonly kind: "configured";
      readonly prices: StripePrices;
      readonly sessions: CheckoutSessions;
    }
  | { readonly kind: "unconfigured" };

export type MemberEmailGateway = {
  findEmail(userId: string): Promise<string>;
};

export type CheckoutGateways = {
  readonly membership: MembershipGateway;
  readonly memberEmails: MemberEmailGateway;
  readonly stripe: CheckoutStripe;
};

/** Por qué no se abre Checkout. Casual no tiene suscripción en E12 (sus packs
 * llegan con E13); quien tiene un cobro fallido conserva su suscripción, que
 * se arregla actualizando la tarjeta (#455), no abriendo otra. */
export type CheckoutRefusal =
  | "stripe_not_configured"
  | "no_plan"
  | "membership_current"
  | "payment_past_due"
  | "casual_plan";

export type CheckoutStart =
  | { readonly kind: "created"; readonly url: string }
  | { readonly kind: "refused"; readonly reason: CheckoutRefusal };

export type CheckoutRequest = {
  readonly userId: string;
  /** El origen de la petición: las direcciones de vuelta tienen que servir en
   * local, en preview y en producción. */
  readonly origin: string;
  readonly now: Date;
};

type Subscribable = {
  readonly membership: Membership;
  readonly plan: RecurringPlan;
};

function checkSubscribable(
  membership: Membership | null,
): Subscribable | CheckoutRefusal {
  if (membership === null || membership.plan === null) {
    return "no_plan";
  }
  if (isMembershipCurrent(membership)) {
    return "membership_current";
  }
  if (membership.status === "past_due") {
    return "payment_past_due";
  }
  if (membership.plan === "Casual") {
    return "casual_plan";
  }
  return { membership, plan: membership.plan };
}

/** La vuelta de Stripe a Pagos, con el parámetro que dice de qué sesión
 * vuelve y cómo acabó. */
export function buildPaymentsReturnUrl(
  origin: string,
  queryParam: string,
  checkoutReturn: CheckoutReturn,
): string {
  const url = new URL(PAYMENTS_PATH, origin);
  url.searchParams.set(queryParam, checkoutReturn);
  return url.toString();
}

/** El cliente que ya tiene en Stripe, o su correo para que Checkout lo cree.
 * Stripe no acepta los dos a la vez. */
async function buildCustomerParams(
  membership: Membership,
  memberEmails: MemberEmailGateway,
): Promise<
  Pick<Stripe.Checkout.SessionCreateParams, "customer" | "customer_email">
> {
  if (membership.stripeCustomerId !== null) {
    return { customer: membership.stripeCustomerId };
  }
  return { customer_email: await memberEmails.findEmail(membership.userId) };
}

/** Sin prueba si la membresía ya tuvo una alguna vez. Los metadatos llevan al
 * socio para que el webhook lo encuentre por la suscripción aunque sus
 * eventos lleguen antes que `checkout.session.completed`. */
function buildSubscriptionData(
  membership: Membership,
): Stripe.Checkout.SessionCreateParams.SubscriptionData {
  const metadata = { user_id: membership.userId };
  return membership.trialEnd === null
    ? { trial_period_days: TRIAL_PERIOD_DAYS, metadata }
    : { metadata };
}

async function buildSessionParams(
  subscribable: Subscribable,
  context: {
    readonly prices: StripePrices;
    readonly memberEmails: MemberEmailGateway;
    readonly origin: string;
  },
): Promise<Stripe.Checkout.SessionCreateParams> {
  const { membership, plan } = subscribable;
  const price = plan === "Full" ? context.prices.full : context.prices.student;
  return {
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    payment_method_collection: "always",
    client_reference_id: membership.userId,
    ...(await buildCustomerParams(membership, context.memberEmails)),
    subscription_data: buildSubscriptionData(membership),
    success_url: buildPaymentsReturnUrl(
      context.origin,
      CHECKOUT_RETURN_QUERY_PARAM,
      "ok",
    ),
    cancel_url: buildPaymentsReturnUrl(
      context.origin,
      CHECKOUT_RETURN_QUERY_PARAM,
      "cancelado",
    ),
  };
}

/** Lleva los parámetros dentro: Stripe rechaza una llave repetida con otros
 * parámetros, y un cambio de plan o de origen tiene que abrir otra sesión. */
export function idempotencyKeyFor(
  params: Stripe.Checkout.SessionCreateParams,
  now: Date,
): string {
  const window = Math.floor(now.getTime() / IDEMPOTENCY_WINDOW_MS);
  const digest = createHash("sha256")
    .update(JSON.stringify(params))
    .digest("hex");
  return `checkout-${digest}-${window}`;
}

export async function startCheckout(
  gateways: CheckoutGateways,
  request: CheckoutRequest,
): Promise<CheckoutStart> {
  const { stripe } = gateways;
  if (stripe.kind === "unconfigured") {
    return { kind: "refused", reason: "stripe_not_configured" };
  }
  const reading = await readMembership(gateways.membership, request);
  const subscribable = checkSubscribable(
    reading.kind === "found" ? reading.membership : null,
  );
  if (typeof subscribable === "string") {
    return { kind: "refused", reason: subscribable };
  }
  const params = await buildSessionParams(subscribable, {
    prices: stripe.prices,
    memberEmails: gateways.memberEmails,
    origin: request.origin,
  });
  const session = await stripe.sessions.create(params, {
    idempotencyKey: idempotencyKeyFor(params, request.now),
  });
  if (session.url === null) {
    throw new Error(
      `Stripe creó la sesión de Checkout de ${request.userId} sin dirección.`,
    );
  }
  return { kind: "created", url: session.url };
}
