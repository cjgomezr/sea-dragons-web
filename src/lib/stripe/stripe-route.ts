import Stripe from "stripe";
import { ApiError } from "@/lib/api/response";
import type { CheckoutStripe } from "@/lib/membership/checkout";
import type { PlanChangeStripe } from "@/lib/membership/plan-change";
import type { SessionPackCheckoutStripe } from "@/lib/membership/session-pack-checkout";
import {
  STRIPE_PRICE_CASUAL_SESSION_ENV,
  createStripeSetup,
} from "./stripe-client";
import { createSubscriptionPlanApi } from "./subscription-plan-api";

/**
 * Lo que comparten los endpoints que piden algo a Stripe para quien llama
 * (#454, #455, #456): el cliente, o que falta, y un fallo de Stripe
 * convertido en 503.
 */

const STRIPE_UNAVAILABLE_REASON = "stripe_unavailable";
const STRIPE_UNAVAILABLE_MESSAGE =
  "Stripe no contesta. Vuelve a intentarlo en un momento.";

export function resolveRouteCheckoutStripe(logPrefix: string): CheckoutStripe {
  const stripe = createStripeSetup(process.env);
  if (stripe.kind === "unconfigured") {
    // Los nombres de lo que falta van al registro del servidor, no a la
    // respuesta, como en el webhook.
    console.warn(`${logPrefix} faltan ${stripe.missingKeys.join(", ")}`);
    return { kind: "unconfigured" };
  }
  return {
    kind: "configured",
    prices: stripe.prices,
    sessions: stripe.client.checkout.sessions,
  };
}

/** Lo que necesita la compra de un pack (#471): Checkout y el precio de una
 * sesión Casual, que no forma parte de la configuración base de E12. */
export function resolveRouteSessionPackStripe(
  logPrefix: string,
): SessionPackCheckoutStripe {
  const stripe = createStripeSetup(process.env);
  const casualSessionPrice =
    process.env[STRIPE_PRICE_CASUAL_SESSION_ENV]?.trim() ?? "";
  const missingKeys = [
    ...(stripe.kind === "unconfigured" ? stripe.missingKeys : []),
    ...(casualSessionPrice === "" ? [STRIPE_PRICE_CASUAL_SESSION_ENV] : []),
  ];
  if (stripe.kind === "unconfigured" || casualSessionPrice === "") {
    console.warn(`${logPrefix} faltan ${missingKeys.join(", ")}`);
    return { kind: "unconfigured" };
  }
  return {
    kind: "configured",
    casualSessionPrice,
    sessions: stripe.client.checkout.sessions,
  };
}

/** Lo que necesita el cambio de plan (#456): la suscripción, y Checkout
 * para el Casual que pasa a Full o Student. */
export function resolveRoutePlanChangeStripe(
  logPrefix: string,
): PlanChangeStripe {
  const stripe = createStripeSetup(process.env);
  if (stripe.kind === "unconfigured") {
    console.warn(`${logPrefix} faltan ${stripe.missingKeys.join(", ")}`);
    return { kind: "unconfigured" };
  }
  return {
    kind: "configured",
    prices: stripe.prices,
    subscriptions: createSubscriptionPlanApi(stripe.client),
    sessions: stripe.client.checkout.sessions,
  };
}

/** Un fallo de Stripe (red, llave, precio) no es culpa de quien pide: 503
 * para que la pantalla ofrezca reintentar. Lo demás se relanza. */
export function asStripeUnavailable(
  logPrefix: string,
): (error: unknown) => never {
  return (error) => {
    if (error instanceof Stripe.errors.StripeError) {
      console.warn(`${logPrefix} Stripe falló: ${error.message}`);
      throw new ApiError(
        "service_unavailable",
        STRIPE_UNAVAILABLE_MESSAGE,
        STRIPE_UNAVAILABLE_REASON,
      );
    }
    throw error;
  };
}
