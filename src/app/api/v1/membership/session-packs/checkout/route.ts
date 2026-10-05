import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError, type ApiErrorCode } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { createPackOptionsGateway } from "@/lib/club/supabase-session-packs-gateways";
import {
  type SessionPackCheckoutRefusal,
  startSessionPackCheckout,
} from "@/lib/membership/session-pack-checkout";
import {
  createMemberEmailGateway,
  createMembershipGateway,
} from "@/lib/membership/supabase-membership-gateways";
import {
  asStripeUnavailable,
  resolveRouteSessionPackStripe,
} from "@/lib/stripe/stripe-route";
import { createServiceRoleClient } from "@/lib/supabase/service-client";

/**
 * Abre Stripe Checkout para que un Casual compre un pack de sesiones (#471,
 * RF-5 del PRD de E13, D1 y D2). Responde la dirección; la pantalla lleva
 * allí al socio. No escribe nada: el saldo lo suma el webhook cuando Stripe
 * confirma el pago.
 */

// Cada petición abre una sesión de Stripe para quien llama.
export const dynamic = "force-dynamic";

export type SessionPackCheckoutResponse = { readonly url: string };

const sessionPackCheckoutBodySchema = z
  .object({ sessions: z.number().int() })
  .strict();

type SessionPackCheckoutBody = z.infer<typeof sessionPackCheckoutBodySchema>;

const REFUSALS: Record<
  SessionPackCheckoutRefusal,
  { readonly code: ApiErrorCode; readonly message: string }
> = {
  stripe_not_configured: {
    code: "service_unavailable",
    message: "Los pagos no están configurados.",
  },
  not_casual: {
    code: "conflict",
    message: "Los packs de sesiones son del plan Casual.",
  },
  pack_not_offered: {
    code: "validation_error",
    message: "El club no ofrece un pack de ese tamaño.",
  },
};

const LOG_PREFIX = "[membership/session-packs/checkout]";

const createSessionPackCheckout = createApiRoute<
  SessionPackCheckoutResponse,
  SessionPackCheckoutBody
>({
  schema: sessionPackCheckoutBodySchema,
  handler: async ({ request, body, decorateResponse }) => {
    const userId = await identifyAccountCaller({ request, decorateResponse });
    const serviceClient = createServiceRoleClient(process.env);
    const outcome = await startSessionPackCheckout(
      {
        membership: createMembershipGateway(serviceClient),
        memberEmails: createMemberEmailGateway(serviceClient),
        packSizes: createPackOptionsGateway(serviceClient),
        stripe: resolveRouteSessionPackStripe(LOG_PREFIX),
      },
      {
        userId,
        origin: request.nextUrl.origin,
        now: new Date(),
        sessions: body.sessions,
      },
    ).catch(asStripeUnavailable(LOG_PREFIX));
    if (outcome.kind === "refused") {
      const refusal = REFUSALS[outcome.reason];
      throw new ApiError(refusal.code, refusal.message, outcome.reason);
    }
    return { data: { url: outcome.url } };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: createSessionPackCheckout,
});
