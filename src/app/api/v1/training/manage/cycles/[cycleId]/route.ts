import { createApiModule } from "@/lib/api/handler";
import {
  type ManagedCycleDetail,
  readManagedCycle,
  updateManagedCycle,
} from "@/lib/training/club-cycles";
import {
  type CycleChangesBody,
  createCycleRoute,
  cycleChangesBodySchema,
} from "@/lib/training/training-manage-api";

/**
 * Un ciclo en Planificar (#904, RF-7): GET con cada semana (nota y dosis) y
 * la cuadrícula, y PATCH para cambiar el nombre, las semanas o el evento. Con
 * evento, el inicio se recalcula. Bajar las semanas cuando las que sobran
 * tienen días con rutina es un 409 con cuántos se perderían, salvo con
 * `confirmRemoval: true`. Un ciclo de otro club responde 404.
 */

// Depende de la sesión de quien llama y del ciclo ahora.
export const dynamic = "force-dynamic";

export type ManagedCycleDetailResponse = ManagedCycleDetail;

export const GET = createCycleRoute<ManagedCycleDetailResponse>({
  run: (gateways, { callerId, cycleId }) =>
    readManagedCycle(gateways, { callerId, cycleId }),
});

export const PATCH = createCycleRoute<
  ManagedCycleDetailResponse,
  CycleChangesBody
>({
  schema: cycleChangesBodySchema,
  run: (gateways, { callerId, cycleId, body }) => {
    const { confirmRemoval, ...changes } = body;
    return updateManagedCycle(gateways, {
      callerId,
      cycleId,
      changes,
      confirmRemoval: confirmRemoval === true,
    });
  },
});

export const { POST, PUT, DELETE } = createApiModule({});
