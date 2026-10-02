import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { openAccountSession } from "@/lib/auth/account-api";
import { readMembership } from "@/lib/membership/membership";
import {
  type MembershipView,
  toMembershipView,
} from "@/lib/membership/membership-view";
import { createMembershipGateway } from "@/lib/membership/supabase-membership-gateways";
import { isStripeConfigured } from "@/lib/stripe/stripe-client";

/**
 * La membresía de quien llama (#454): Pagos la vuelve a pedir mientras espera
 * que el webhook de Stripe confirme el Checkout. Va con el cliente de la
 * sesión: `memberships_select_own` deja a cada socio leer sólo la suya.
 */

// Depende de la sesión de quien llama y de lo que acaba de escribir el webhook.
export const dynamic = "force-dynamic";

export type MembershipResponse = MembershipView;

const getMembership = createApiRoute<MembershipResponse>({
  handler: async ({ request, decorateResponse }) => {
    const session = await openAccountSession({ request, decorateResponse });
    const reading = await readMembership(
      createMembershipGateway(session.client),
      { userId: session.userId, now: new Date() },
    );
    return {
      data: toMembershipView(reading, isStripeConfigured(process.env)),
    };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getMembership,
});
