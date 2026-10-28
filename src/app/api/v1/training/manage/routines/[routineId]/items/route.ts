import { createApiModule } from "@/lib/api/handler";
import {
  type SavedRoutineItems,
  saveRoutineItems,
} from "@/lib/training/club-routines";
import {
  createRoutineRoute,
  routineItemsBodySchema,
} from "@/lib/training/training-manage-api";

/**
 * Las filas de una rutina (#905, RF-9, D9 y D10 del PRD de E35): PUT con la
 * lista entera la sustituye en ese orden y responde lo guardado. Una fila
 * que no vale, más de 60, o un ejercicio o una marca de otro club es un 400
 * que dice cuál; una rutina de otro club, un 404.
 */

// Depende de la sesión de quien llama y de la rutina ahora.
export const dynamic = "force-dynamic";

export type SavedRoutineItemsResponse = SavedRoutineItems;

type RoutineItemsBody = { readonly items: readonly unknown[] };

export const PUT = createRoutineRoute<
  SavedRoutineItemsResponse,
  RoutineItemsBody
>({
  schema: routineItemsBodySchema,
  run: (gateways, { callerId, routineId, body }) =>
    saveRoutineItems(gateways, { callerId, routineId, items: body.items }),
});

export const { GET, POST, PATCH, DELETE } = createApiModule({});
