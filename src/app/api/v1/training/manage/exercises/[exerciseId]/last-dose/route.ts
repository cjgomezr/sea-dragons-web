import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { ExerciseNotFoundError } from "@/lib/training/club-exercises";
import {
  type ExerciseLastDose,
  findLastExerciseDose,
} from "@/lib/training/club-routines";
import {
  asTrainingManageApiError,
  readRouteId,
  requireClubRoutinesGateways,
} from "@/lib/training/training-manage-api";

/**
 * La última dosis que el club usó con un ejercicio (#905, RF-9 del PRD de
 * E35): las series, repeticiones, descanso y carga de la última fila del
 * club con él, o nula si nunca se usó. El editor la copia en la fila nueva.
 * Un ejercicio de otro club responde 404.
 */

// Depende de la sesión de quien llama y de las rutinas del club ahora.
export const dynamic = "force-dynamic";

export type ExerciseLastDoseResponse = ExerciseLastDose;

type ExerciseRouteContext = {
  readonly params: Promise<{ readonly exerciseId: string }>;
};

export function GET(
  request: NextRequest,
  context: ExerciseRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<ExerciseLastDoseResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const exerciseId = readRouteId(
        (await context.params).exerciseId,
        new ExerciseNotFoundError(),
      );
      try {
        return {
          data: await findLastExerciseDose(requireClubRoutinesGateways(), {
            callerId,
            exerciseId,
          }),
        };
      } catch (error) {
        return asTrainingManageApiError(error);
      }
    },
  });
  return route(request);
}

export const { POST, PUT, PATCH, DELETE } = createApiModule({});
