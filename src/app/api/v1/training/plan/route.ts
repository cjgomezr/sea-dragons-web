import { createApiModule, createApiRoute } from "@/lib/api/handler";
import {
  ApiError,
  ApiErrorWithDetails,
  MEMBERSHIP_NOT_CURRENT_REASON,
} from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { createSupabaseTrainingPlanGateways } from "@/lib/training/supabase-training-plan-gateways";
import {
  type TrainingPlan,
  TrainingPlanBlockedError,
  type TrainingPlanGateways,
  TrainingWeekOutOfRangeError,
  readTrainingPlan,
} from "@/lib/training/training-plan";

/**
 * La semana del ciclo activo que ve el socio (#898, RF-3, RF-4 y RF-6 del PRD
 * de E35). Sin `?week`, la de hoy en Melbourne; con `?week=k`, la k. Quien no
 * está al día recibe un 403 con su motivo y la cabecera del ciclo; el Admin y
 * el Coach reciben el plan siempre (D3).
 */

// Depende de la sesión de quien llama, de su membresía y de la fecha de hoy.
export const dynamic = "force-dynamic";

export type TrainingPlanResponse = TrainingPlan;

const WEEK_PARAM = "week";
const WHOLE_NUMBER = /^\d+$/;

const BLOCKED_MESSAGE =
  "Tu membresía no está al día: renuévala en Pagos para ver el plan de entrenamiento.";

function requireTrainingPlanGateways(): TrainingPlanGateways {
  const wiring = createSupabaseTrainingPlanGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

/** La semana pedida, o nula si no se pidió ninguna. Que esté dentro del
 * ciclo lo decide el dominio, que conoce sus semanas. */
function parseWeekParam(searchParams: URLSearchParams): number | null {
  const week = searchParams.get(WEEK_PARAM);
  if (week === null) {
    return null;
  }
  if (!WHOLE_NUMBER.test(week)) {
    throw new ApiError(
      "validation_error",
      `La semana tiene que ser un número entero, no "${week}".`,
    );
  }
  return Number(week);
}

function asTrainingPlanApiError(error: unknown): never {
  if (error instanceof TrainingPlanBlockedError) {
    throw new ApiErrorWithDetails("forbidden", BLOCKED_MESSAGE, {
      reason: MEMBERSHIP_NOT_CURRENT_REASON,
      details: { block: error.block, cycle: error.cycle },
    });
  }
  if (error instanceof TrainingWeekOutOfRangeError) {
    throw new ApiError("validation_error", error.message);
  }
  return asAccountApiError(error);
}

const getTrainingPlan = createApiRoute<TrainingPlanResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    const week = parseWeekParam(request.nextUrl.searchParams);
    try {
      return {
        data: await readTrainingPlan(requireTrainingPlanGateways(), {
          callerId,
          now: new Date(),
          week,
        }),
      };
    } catch (error) {
      return asTrainingPlanApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getTrainingPlan,
});
