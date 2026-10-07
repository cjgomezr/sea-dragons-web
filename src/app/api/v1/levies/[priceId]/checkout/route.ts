import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError, type ApiErrorCode } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  type LevyCheckoutRefusal,
  startLevyCheckout,
} from "@/lib/membership/levies";
import {
  createMemberEmailGateway,
  createMembershipGateway,
  createPaidProductsGateway,
} from "@/lib/membership/supabase-membership-gateways";
import {
  asStripeUnavailable,
  resolveRouteLevyStripe,
} from "@/lib/stripe/stripe-route";
import { createServiceRoleClient } from "@/lib/supabase/service-client";

/**
 * Abre Stripe Checkout para pagar un levy (#473, RF-6 del PRD de E13, D4).
 * Responde la dirección; la pantalla lleva allí al socio. No escribe nada:
 * el pago lo guarda el webhook cuando Stripe lo confirma, y la membresía no
 * cambia.
 */

// Cada petición abre una sesión de Stripe para quien llama.
export const dynamic = "force-dynamic";

export type LevyCheckoutResponse = { readonly url: string };

type LevyCheckoutRouteContext = {
  readonly params: Promise<{ readonly priceId: string }>;
};

const REFUSALS: Record<
  LevyCheckoutRefusal,
  { readonly code: ApiErrorCode; readonly message: string }
> = {
  stripe_not_configured: {
    code: "service_unavailable",
    message: "Los pagos no están configurados.",
  },
  levy_not_found: {
    code: "not_found",
    message: "No hay un levy activo con ese precio.",
  },
  levy_already_paid: {
    code: "conflict",
    message: "Ya pagaste este levy.",
  },
};

const LOG_PREFIX = "[levies/checkout]";

export function POST(
  request: NextRequest,
  context: LevyCheckoutRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<LevyCheckoutResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const userId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const serviceClient = createServiceRoleClient(process.env);
      const outcome = await startLevyCheckout(
        {
          membership: createMembershipGateway(serviceClient),
          memberEmails: createMemberEmailGateway(serviceClient),
          paidProducts: createPaidProductsGateway(serviceClient),
          stripe: resolveRouteLevyStripe(LOG_PREFIX),
        },
        {
          userId,
          origin: apiRequest.nextUrl.origin,
          now: new Date(),
          priceId: (await context.params).priceId,
        },
      ).catch(asStripeUnavailable(LOG_PREFIX));
      if (outcome.kind === "refused") {
        const refusal = REFUSALS[outcome.reason];
        throw new ApiError(refusal.code, refusal.message, outcome.reason);
      }
      return { data: { url: outcome.url } };
    },
  });
  return route(request);
}

export const { GET, PUT, PATCH, DELETE } = createApiModule({});
