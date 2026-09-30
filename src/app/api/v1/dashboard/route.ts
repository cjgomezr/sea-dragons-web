import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  type Dashboard,
  type DashboardGateways,
  readDashboard,
} from "@/lib/dashboard/dashboard";
import { createSupabaseDashboardGateways } from "@/lib/dashboard/supabase-dashboard-gateways";

/**
 * Todo lo que pinta la pantalla de inicio en una sola petición (#424, RF-6
 * del PRD de E14, CON-002): las cuatro teselas, los tres próximos eventos y
 * las tres últimas noticias. Una fuente caída llega como `unavailable` y el
 * resto se sirve con 200.
 */

// Depende de la sesión de quien llama y del estado actual del club.
export const dynamic = "force-dynamic";

export type DashboardResponse = Dashboard;

function requireDashboardGateways(): DashboardGateways {
  const wiring = createSupabaseDashboardGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

const getDashboard = createApiRoute<DashboardResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await readDashboard(requireDashboardGateways(), {
          callerId,
          now: new Date(),
        }),
      };
    } catch (error) {
      return asAccountApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getDashboard,
});
