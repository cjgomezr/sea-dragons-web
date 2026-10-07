import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { type Levy, listLevies } from "@/lib/membership/levies";
import { createPaidProductsGateway } from "@/lib/membership/supabase-membership-gateways";
import {
  asStripeUnavailable,
  resolveRouteLevyStripe,
} from "@/lib/stripe/stripe-route";
import { createServiceRoleClient } from "@/lib/supabase/service-client";

/**
 * Los levies que el comité crea en Stripe (#473, RF-6 del PRD de E13, D4 y
 * D8), con si quien llama ya pagó cada uno. Los lee cualquier cuenta activa,
 * al día o no. Stripe se consulta desde el servidor, nunca desde el navegador
 * (INT-007).
 */

// Depende de quien llama y de lo que hay ahora en Stripe.
export const dynamic = "force-dynamic";

export type LeviesResponse = { readonly levies: readonly Levy[] };

const LOG_PREFIX = "[levies]";

const readLevies = createApiRoute<LeviesResponse>({
  handler: async ({ request, decorateResponse }) => {
    const userId = await identifyAccountCaller({ request, decorateResponse });
    const listing = await listLevies(
      {
        paidProducts: createPaidProductsGateway(
          createServiceRoleClient(process.env),
        ),
        stripe: resolveRouteLevyStripe(LOG_PREFIX),
      },
      { userId },
    ).catch(asStripeUnavailable(LOG_PREFIX));
    if (listing.kind === "refused") {
      throw new ApiError(
        "service_unavailable",
        "Los pagos no están configurados.",
        listing.reason,
      );
    }
    return { data: { levies: listing.levies } };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: readLevies,
});
