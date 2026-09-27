import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  type RefreshedEvaluation,
  refreshMemberEvaluation,
} from "@/lib/evaluations/member-evaluation";
import {
  type MemberEvaluationRouteContext,
  asEvaluationApiError,
  readMemberId,
  requireMemberEvaluationGateways,
} from "@/lib/evaluations/member-evaluation-api";

/**
 * Poner al día la evaluación de un miembro (#320, RF-4 del PRD de E9): las
 * categorías activas que le faltan entran en 5, las desactivadas salen y el
 * OVR se recalcula. Es un POST propio y no un efecto de guardar, porque
 * FR-053 la pide explícita y editar no migra (AC-035).
 *
 * Responde 200 también si ya estaba al día: no es un error, y `outcome` lo
 * dice. Cuelga de `EVALUATIONS_API_PATH`, así que la frontera lo reserva a
 * Admin y Coach, y el dominio lo vuelve a comprobar (FR-055).
 */

// Depende de la sesión de quien llama y de la evaluación ahora.
export const dynamic = "force-dynamic";

/** Qué pasó y la evaluación tal como quedó. */
export type RefreshedEvaluationResponse = RefreshedEvaluation;

export function POST(
  request: NextRequest,
  context: MemberEvaluationRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<RefreshedEvaluationResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const memberId = await readMemberId(context);
      try {
        return {
          data: await refreshMemberEvaluation(
            requireMemberEvaluationGateways(),
            { callerId, memberId },
          ),
        };
      } catch (error) {
        asEvaluationApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, PUT, PATCH, DELETE } = createApiModule({});
