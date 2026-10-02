import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError, type ApiErrorCode } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  type CardUpdateRefusal,
  startCardUpdate,
} from "@/lib/membership/card-update";
import { createMembershipGateway } from "@/lib/membership/supabase-membership-gateways";
import {
  asStripeUnavailable,
  resolveRouteCheckoutStripe,
} from "@/lib/stripe/stripe-route";
import { createServiceRoleClient } from "@/lib/supabase/service-client";

/**
 * Abre Stripe Checkout en modo `setup` para cambiar la tarjeta (#455, RF-5
 * del PRD de E12, D6). Responde la dirección; la tarjeta nueva la escribe
 * Stripe y la trae el webhook (#452). Lo alcanza también quien tiene un cobro
 * fallido: cambiar la tarjeta es como se pone al día.
 */

// Cada petición abre una sesión de Stripe para quien llama.
export const dynamic = "force-dynamic";

export type MembershipCardResponse = { readonly url: string };

const LOG_PREFIX = "[membership/card]";

const REFUSALS: Record<
  CardUpdateRefusal,
  { readonly code: ApiErrorCode; readonly message: string }
> = {
  stripe_not_configured: {
    code: "service_unavailable",
    message: "Los pagos no están configurados.",
  },
  no_stripe_customer: {
    code: "conflict",
    message: "Aún no tienes tarjeta en Stripe: añádela desde Pagos.",
  },
};

const createCardSession = createApiRoute<MembershipCardResponse>({
  handler: async ({ request, decorateResponse }) => {
    const userId = await identifyAccountCaller({ request, decorateResponse });
    const outcome = await startCardUpdate(
      {
        membership: createMembershipGateway(
          createServiceRoleClient(process.env),
        ),
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
  POST: createCardSession,
});
