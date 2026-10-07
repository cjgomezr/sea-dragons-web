import Stripe from "stripe";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError, type ApiErrorCode } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  type PaymentRetryRefusal,
  startPaymentRetry,
} from "@/lib/membership/retry-payment";
import { createMembershipGateway } from "@/lib/membership/supabase-membership-gateways";
import { resolveRoutePaymentRetryStripe } from "@/lib/stripe/stripe-route";
import { createServiceRoleClient } from "@/lib/supabase/service-client";

/**
 * Reintentar un cobro fallido (#474, RF-7 del PRD de E13, D5): responde la
 * página que aloja Stripe para la factura abierta de la suscripción. Lo
 * alcanza quien no está al día, que es quien la necesita; la membresía vuelve
 * a `active` cuando Stripe avisa de `invoice.paid` (#452).
 */

// Cada petición pregunta a Stripe por la factura de quien llama.
export const dynamic = "force-dynamic";

export type MembershipRetryPaymentResponse = { readonly url: string };

const LOG_PREFIX = "[membership/retry-payment]";

const REFUSALS: Record<
  PaymentRetryRefusal,
  { readonly code: ApiErrorCode; readonly message: string }
> = {
  stripe_not_configured: {
    code: "service_unavailable",
    message: "Los pagos no están configurados.",
  },
  no_open_invoice: {
    code: "conflict",
    message: "No tienes ningún pago pendiente.",
  },
};

const STRIPE_FAILED_REASON = "stripe_failed";

/** El reintento lo pide el ticket como 502: Stripe está configurado y fue
 * Stripe quien falló. Lo que no es de Stripe se relanza. */
function asStripeBadGateway(error: unknown): never {
  if (error instanceof Stripe.errors.StripeError) {
    console.warn(`${LOG_PREFIX} Stripe falló: ${error.message}`);
    throw new ApiError(
      "bad_gateway",
      "Stripe no pudo abrir el pago. Vuelve a intentarlo en un momento.",
      STRIPE_FAILED_REASON,
    );
  }
  throw error;
}

const retryPayment = createApiRoute<MembershipRetryPaymentResponse>({
  handler: async ({ request, decorateResponse }) => {
    const userId = await identifyAccountCaller({ request, decorateResponse });
    const outcome = await startPaymentRetry(
      {
        membership: createMembershipGateway(
          createServiceRoleClient(process.env),
        ),
        stripe: resolveRoutePaymentRetryStripe(LOG_PREFIX),
      },
      { userId, now: new Date() },
    ).catch(asStripeBadGateway);
    if (outcome.kind === "refused") {
      const refusal = REFUSALS[outcome.reason];
      throw new ApiError(refusal.code, refusal.message, outcome.reason);
    }
    return { data: { url: outcome.url } };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: retryPayment,
});
