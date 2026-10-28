import { createApiModule } from "@/lib/api/handler";
import {
  type DeletedRoutine,
  type ManagedRoutineResult,
  deleteClubRoutine,
  renameClubRoutine,
} from "@/lib/training/club-routines";
import {
  createRoutineRoute,
  readConfirm,
  routineNameBodySchema,
} from "@/lib/training/training-manage-api";

/**
 * Renombrar o borrar una rutina (#905, RF-9 del PRD de E35). Un nombre vacío
 * o de más de 60 es un 400. Borrar una usada en la cuadrícula es un 409 con
 * en cuántos días, salvo con `?confirm=true`, que la borra y deja esos días
 * en descanso. Una rutina de otro club responde 404.
 */

// Depende de la sesión de quien llama y de la rutina ahora.
export const dynamic = "force-dynamic";

export type ManagedRoutineResponse = ManagedRoutineResult;

export type DeletedRoutineResponse = DeletedRoutine;

type RoutineNameBody = { readonly name: string };

export const PATCH = createRoutineRoute<
  ManagedRoutineResponse,
  RoutineNameBody
>({
  schema: routineNameBodySchema,
  run: (gateways, { callerId, routineId, body }) =>
    renameClubRoutine(gateways, { callerId, routineId, name: body.name }),
});

export const DELETE = createRoutineRoute<DeletedRoutineResponse>({
  run: (gateways, { callerId, routineId, searchParams }) =>
    deleteClubRoutine(gateways, {
      callerId,
      routineId,
      confirm: readConfirm(searchParams),
    }),
});

export const { GET, POST, PUT } = createApiModule({});
