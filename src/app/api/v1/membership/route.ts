import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { openAccountSession } from "@/lib/auth/account-api";
import {
  type MembershipView,
  readMembershipView,
} from "@/lib/membership/membership-view";
import {
  createMembershipGateway,
  createPaymentHistoryGateway,
  createSessionLedgerGateway,
} from "@/lib/membership/supabase-membership-gateways";
import { createRouteClubPriceReader } from "@/lib/stripe/club-prices";
import { isStripeConfigured } from "@/lib/stripe/stripe-client";

/**
 * La membresía de quien llama (#454, #455): el panel de Pagos con su plan,
 * estado, próximo cobro, tarjeta, exención, historial y saldo de sesiones
 * (#472). Pagos la vuelve a pedir mientras espera al webhook de Stripe. Va
 * con el cliente de la sesión: `memberships_select_own`,
 * `payments_select_own` y `session_ledger_select_own` dejan a cada socio leer
 * sólo lo suyo. El precio del plan se lee de Stripe (#486).
 */

// Depende de la sesión de quien llama y de lo que acaba de escribir el webhook.
export const dynamic = "force-dynamic";

export type MembershipResponse = MembershipView;

const getMembership = createApiRoute<MembershipResponse>({
  handler: async ({ request, decorateResponse }) => {
    const session = await openAccountSession({ request, decorateResponse });
    const view = await readMembershipView(
      {
        membership: createMembershipGateway(session.client),
        payments: createPaymentHistoryGateway(session.client),
        sessionLedger: createSessionLedgerGateway(session.client),
        prices: createRouteClubPriceReader(),
      },
      {
        userId: session.userId,
        now: new Date(),
        paymentsConfigured: isStripeConfigured(process.env),
      },
    );
    return { data: view };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getMembership,
});
