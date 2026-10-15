import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { type LevyBuyer, readLevyBuyers } from "@/lib/membership/levy-sales";
import { createClubMembersGateway } from "@/lib/membership/supabase-levy-payers-gateways";
import { createLevySalesPaymentsGateway } from "@/lib/membership/supabase-levy-sales-gateways";
import { createServiceRoleClient } from "@/lib/supabase/service-client";

/**
 * Quién compró un extra, una fila por compra (#634, RF-8 del PRD de E23),
 * sin lista de faltantes (D1). Va por el producto de Stripe y sale de la
 * base: sirve igual para un extra cerrado o borrado de Stripe (D5). Sólo lo
 * alcanzan un Admin y un Committee: la frontera responde 403 a los demás
 * (`RESTRICTED_ROUTES`).
 */

// Depende de lo que hay ahora en la base.
export const dynamic = "force-dynamic";

export type LevyBuyersResponse = { readonly buyers: readonly LevyBuyer[] };

type LevyBuyersRouteContext = {
  readonly params: Promise<{ readonly productId: string }>;
};

export function GET(
  request: NextRequest,
  context: LevyBuyersRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<LevyBuyersResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const serviceClient = createServiceRoleClient(process.env);
      const buyers = await readLevyBuyers(
        {
          clubMembers: createClubMembersGateway(serviceClient),
          levyPayments: createLevySalesPaymentsGateway(serviceClient),
        },
        { callerId, productId: (await context.params).productId },
      ).catch(asAccountApiError);
      return { data: { buyers } };
    },
  });
  return route(request);
}

export const { POST, PUT, PATCH, DELETE } = createApiModule({});
