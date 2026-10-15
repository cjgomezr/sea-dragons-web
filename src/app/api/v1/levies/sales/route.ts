import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { type LevySale, readLevySales } from "@/lib/membership/levy-sales";
import { createClubMembersGateway } from "@/lib/membership/supabase-levy-payers-gateways";
import { createLevySalesPaymentsGateway } from "@/lib/membership/supabase-levy-sales-gateways";
import {
  asStripeUnavailable,
  resolveRouteLevySalesStripe,
} from "@/lib/stripe/stripe-route";
import { createServiceRoleClient } from "@/lib/supabase/service-client";

/**
 * Qué se vendió de cada extra (#634, RF-8 del PRD de E23): los que están a
 * la venta y los cerrados con alguna venta, en una sola llamada (D7). Sólo lo
 * alcanzan un Admin y un Committee: la frontera responde 403 a los demás
 * (`RESTRICTED_ROUTES`).
 */

// Depende de lo que hay ahora en Stripe y en la base.
export const dynamic = "force-dynamic";

export type LevySalesResponse = { readonly sales: readonly LevySale[] };

const LOG_PREFIX = "[levies/sales]";

const readSales = createApiRoute<LevySalesResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    const serviceClient = createServiceRoleClient(process.env);
    const reading = await readLevySales(
      {
        clubMembers: createClubMembersGateway(serviceClient),
        levyPayments: createLevySalesPaymentsGateway(serviceClient),
        stripe: resolveRouteLevySalesStripe(LOG_PREFIX),
      },
      { callerId },
    )
      .catch(asStripeUnavailable(LOG_PREFIX))
      .catch(asAccountApiError);
    if (reading.kind === "refused") {
      throw new ApiError(
        "service_unavailable",
        "Los pagos no están configurados.",
        reading.reason,
      );
    }
    return { data: { sales: reading.sales } };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: readSales,
});
