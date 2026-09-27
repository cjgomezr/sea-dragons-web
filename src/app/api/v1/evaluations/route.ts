import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  type EvaluationRoster,
  type EvaluationRosterGateways,
  listEvaluationRoster,
} from "@/lib/evaluations/evaluation-roster";
import { EvaluationForbiddenError } from "@/lib/evaluations/member-evaluation";
import { createSupabaseEvaluationRosterGateways } from "@/lib/evaluations/supabase-evaluation-roster-gateways";

/**
 * La lista de la pantalla de Evaluaciones (#322, RF-6 del PRD de E9): los
 * miembros del club con su OVR, y quién está sin evaluar.
 *
 * `RESTRICTED_ROUTES` ya reserva este camino a Admin y Coach, y el dominio lo
 * vuelve a comprobar (FR-055). Buscar por nombre lo hace quien la pinta: el
 * club tiene decenas de miembros y la lista llega entera.
 */

// Depende de la sesión de quien llama y de las evaluaciones ahora.
export const dynamic = "force-dynamic";

export type EvaluationRosterResponse = EvaluationRoster;

function requireEvaluationRosterGateways(): EvaluationRosterGateways {
  const wiring = createSupabaseEvaluationRosterGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

const getEvaluationRoster = createApiRoute<EvaluationRosterResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await listEvaluationRoster(
          requireEvaluationRosterGateways(),
          callerId,
        ),
      };
    } catch (error) {
      if (error instanceof EvaluationForbiddenError) {
        throw new ApiError("forbidden", error.message);
      }
      return asAccountApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getEvaluationRoster,
});
