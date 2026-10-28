import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { NO_CONTENT_STATUS } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { readClubExerciseForm } from "@/lib/training/club-exercise-form";
import {
  ExerciseNotFoundError,
  type ManagedExercise,
  deleteClubExercise,
  updateClubExercise,
} from "@/lib/training/club-exercises";
import {
  asTrainingManageApiError,
  readRouteId,
  requireClubExercisesGateways,
} from "@/lib/training/training-manage-api";

/**
 * Editar o borrar un ejercicio del club (#903, RF-10 del PRD de E35). PATCH
 * recibe el formulario entero, como al crearlo, y responde cómo quedó. DELETE
 * responde 204, o 409 si alguna rutina lo usa. Uno de la biblioteca responde
 * 403; uno de otro club, 404, como uno que no existe.
 */

// Depende de la sesión de quien llama y de los ejercicios del club ahora.
export const dynamic = "force-dynamic";

export type ManagedExerciseResponse = ManagedExercise;

type ExerciseRouteContext = {
  readonly params: Promise<{ readonly exerciseId: string }>;
};

async function readExerciseId(context: ExerciseRouteContext): Promise<string> {
  return readRouteId(
    (await context.params).exerciseId,
    new ExerciseNotFoundError(),
  );
}

export function PATCH(
  request: NextRequest,
  context: ExerciseRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<ManagedExerciseResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const exerciseId = await readExerciseId(context);
      try {
        const form = await readClubExerciseForm(apiRequest, "update");
        return {
          data: await updateClubExercise(requireClubExercisesGateways(), {
            callerId,
            exerciseId,
            ...form,
          }),
        };
      } catch (error) {
        return asTrainingManageApiError(error);
      }
    },
  });
  return route(request);
}

export function DELETE(
  request: NextRequest,
  context: ExerciseRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<never>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const exerciseId = await readExerciseId(context);
      try {
        await deleteClubExercise(requireClubExercisesGateways(), {
          callerId,
          exerciseId,
        });
        return { status: NO_CONTENT_STATUS };
      } catch (error) {
        return asTrainingManageApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, POST, PUT } = createApiModule({});
