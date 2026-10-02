import Stripe from "stripe";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError, type ApiErrorCode } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  type CheckoutRefusal,
  type CheckoutStripe,
  startCheckout,
} from "@/lib/membership/checkout";
import {
  createMemberEmailGateway,
  createMembershipGateway,
} from "@/lib/membership/supabase-membership-gateways";
import { createStripeSetup } from "@/lib/stripe/stripe-client";
import { createServiceRoleClient } from "@/lib/supabase/service-client";

/**
 * Abre Stripe Checkout para que el socio ponga la tarjeta (#454, RF-3 del
 * PRD de E12, D3). Responde la dirección; la pantalla lleva allí al socio.
 * No escribe nada: la membresía la mueve el webhook (#452) cuando Stripe
 * confirma.
 */

// Cada petición abre una sesión de Stripe para quien llama.
export const dynamic = "force-dynamic";

export type MembershipCheckoutResponse = { readonly url: string };

const STRIPE_UNAVAILABLE_REASON = "stripe_unavailable";
const STRIPE_UNAVAILABLE_MESSAGE =
  "Stripe no contesta. Vuelve a intentarlo en un momento.";

const REFUSALS: Record<
  CheckoutRefusal,
  { readonly code: ApiErrorCode; readonly message: string }
> = {
  stripe_not_configured: {
    code: "service_unavailable",
    message: "Los pagos no están configurados.",
  },
  no_plan: {
    code: "conflict",
    message: "Tu membresía no tiene plan todavía.",
  },
  membership_current: {
    code: "conflict",
    message: "Tu membresía ya está al día.",
  },
  payment_past_due: {
    code: "conflict",
    message:
      "Tu suscripción tiene un cobro fallido: actualiza la tarjeta en vez de abrir otra.",
  },
  casual_plan: {
    code: "conflict",
    message:
      "Los packs de Casual llegan más adelante; un Admin puede activarte.",
  },
};

function checkoutStripe(): CheckoutStripe {
  const stripe = createStripeSetup(process.env);
  if (stripe.kind === "unconfigured") {
    // Los nombres de lo que falta van al registro del servidor, no a la
    // respuesta, como en el webhook.
    console.warn(
      `[membership/checkout] faltan ${stripe.missingKeys.join(", ")}`,
    );
    return { kind: "unconfigured" };
  }
  return {
    kind: "configured",
    prices: stripe.prices,
    sessions: stripe.client.checkout.sessions,
  };
}

/** Un fallo de Stripe (red, llave, precio) no es culpa de quien pide: 503
 * para que la pantalla ofrezca reintentar. Lo demás se relanza. */
function asStripeUnavailable(error: unknown): never {
  if (error instanceof Stripe.errors.StripeError) {
    console.warn(`[membership/checkout] Stripe falló: ${error.message}`);
    throw new ApiError(
      "service_unavailable",
      STRIPE_UNAVAILABLE_MESSAGE,
      STRIPE_UNAVAILABLE_REASON,
    );
  }
  throw error;
}

const createCheckout = createApiRoute<MembershipCheckoutResponse>({
  handler: async ({ request, decorateResponse }) => {
    const userId = await identifyAccountCaller({ request, decorateResponse });
    const serviceClient = createServiceRoleClient(process.env);
    const outcome = await startCheckout(
      {
        membership: createMembershipGateway(serviceClient),
        memberEmails: createMemberEmailGateway(serviceClient),
        stripe: checkoutStripe(),
      },
      { userId, origin: request.nextUrl.origin, now: new Date() },
    ).catch(asStripeUnavailable);
    if (outcome.kind === "refused") {
      const refusal = REFUSALS[outcome.reason];
      throw new ApiError(refusal.code, refusal.message, outcome.reason);
    }
    return { data: { url: outcome.url } };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: createCheckout,
});
