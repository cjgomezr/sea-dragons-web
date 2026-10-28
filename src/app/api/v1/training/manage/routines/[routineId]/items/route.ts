import { createApiModule } from "@/lib/api/handler";
import {
  type RoutineEditor,
  type SavedRoutineItems,
  readRoutineEditor,
  saveRoutineItems,
} from "@/lib/training/club-routines";
import {
  createRoutineRoute,
  routineItemsBodySchema,
} from "@/lib/training/training-manage-api";

/**
 * Las filas de una rutina (#905, RF-9, D9 y D10 del PRD de E35). GET las
 * devuelve en su orden, cada ejercicio con su nombre y su foto, para abrir
 * la rutina en el editor (#908). PUT con la
 * lista entera la sustituye en ese orden y responde lo guardado. Una fila
 * que no vale, más de 60, o un ejercicio o una marca de otro club es un 400
 * que dice cuál; una rutina de otro club, un 404.
 */

// Depende de la sesión de quien llama y de la rutina ahora.
export const dynamic = "force-dynamic";

export type RoutineEditorResponse = RoutineEditor;

export type SavedRoutineItemsResponse = SavedRoutineItems;

type RoutineItemsBody = { readonly items: readonly unknown[] };

export const GET = createRoutineRoute<RoutineEditorResponse>({
  run: (gateways, { callerId, routineId }) =>
    readRoutineEditor(gateways, { callerId, routineId }),
});

export const PUT = createRoutineRoute<
  SavedRoutineItemsResponse,
  RoutineItemsBody
>({
  schema: routineItemsBodySchema,
  run: (gateways, { callerId, routineId, body }) =>
    saveRoutineItems(gateways, { callerId, routineId, items: body.items }),
});

export const { POST, PATCH, DELETE } = createApiModule({});
