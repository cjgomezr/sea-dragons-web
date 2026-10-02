import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError, type ApiErrorCode } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { type CheckoutRefusal, startCheckout } from "@/lib/membership/checkout";
import {
  createMemberEmailGateway,
  createMembershipGateway,
} from "@/lib/membership/supabase-membership-gateways";
import {
  asStripeUnavailable,
  resolveRouteCheckoutStripe,
} from "@/lib/stripe/stripe-route";
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

const LOG_PREFIX = "[membership/checkout]";

const createCheckout = createApiRoute<MembershipCheckoutResponse>({
  handler: async ({ request, decorateResponse }) => {
    const userId = await identifyAccountCaller({ request, decorateResponse });
    const serviceClient = createServiceRoleClient(process.env);
    const outcome = await startCheckout(
      {
        membership: createMembershipGateway(serviceClient),
        memberEmails: createMemberEmailGateway(serviceClient),
        stripe: resolveRouteCheckoutStripe(LOG_PREFIX),
      },
      { userId, origin: request.nextUrl.origin, now: new Date() },
    ).catch(asStripeUnavailable(LOG_PREFIX));
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
