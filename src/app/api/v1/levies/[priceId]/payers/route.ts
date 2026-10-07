import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError, type ApiErrorCode } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import {
  type LevyPayersRefusal,
  type LevyPayersReport,
  readLevyPayers,
} from "@/lib/membership/levy-payers";
import {
  createClubMembersGateway,
  createLevyPaymentsGateway,
} from "@/lib/membership/supabase-levy-payers-gateways";
import {
  asStripeUnavailable,
  resolveRouteLevyStripe,
} from "@/lib/stripe/stripe-route";
import { createServiceRoleClient } from "@/lib/supabase/service-client";

/**
 * Quién pagó un levy y quién falta (#531, ampliación de FR-069). Sólo lo
 * alcanzan un Admin y un Committee: la frontera responde 403 a los demás
 * (`RESTRICTED_ROUTES`). El levy se valida contra el catálogo de Stripe como
 * al pagarlo: uno archivado deja de existir aquí también.
 */

// Depende de lo que hay ahora en Stripe y en la base.
export const dynamic = "force-dynamic";

export type LevyPayersResponse = LevyPayersReport;

type LevyPayersRouteContext = {
  readonly params: Promise<{ readonly priceId: string }>;
};

const REFUSALS: Record<
  LevyPayersRefusal,
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
};

const LOG_PREFIX = "[levies/payers]";

export function GET(
  request: NextRequest,
  context: LevyPayersRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<LevyPayersResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const serviceClient = createServiceRoleClient(process.env);
      const reading = await readLevyPayers(
        {
          clubMembers: createClubMembersGateway(serviceClient),
          levyPayments: createLevyPaymentsGateway(serviceClient),
          stripe: resolveRouteLevyStripe(LOG_PREFIX),
        },
        { callerId, priceId: (await context.params).priceId },
      )
        .catch(asStripeUnavailable(LOG_PREFIX))
        .catch(asAccountApiError);
      if (reading.kind === "refused") {
        const refusal = REFUSALS[reading.reason];
        throw new ApiError(refusal.code, refusal.message, reading.reason);
      }
      return { data: reading.report };
    },
  });
  return route(request);
}

export const { POST, PUT, PATCH, DELETE } = createApiModule({});
