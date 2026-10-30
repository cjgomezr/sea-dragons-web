import { createApiModule } from "@/lib/api/handler";
import {
  type ManagedCycleDetail,
  type ManagedCycles,
  deleteManagedCycle,
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
 * `confirmRemoval: true`. DELETE borra un borrador o un archivado (#935) y
 * responde la lista entera; el activo es un 409 `cycle_is_active`. Un ciclo
 * de otro club responde 404.
 */

// Depende de la sesión de quien llama y del ciclo ahora.
export const dynamic = "force-dynamic";

export type ManagedCycleDetailResponse = ManagedCycleDetail;

export type ManagedCyclesResponse = ManagedCycles;

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

export const DELETE = createCycleRoute<ManagedCyclesResponse>({
  run: (gateways, { callerId, cycleId }) =>
    deleteManagedCycle(gateways, { callerId, cycleId }),
});

export const { POST, PUT } = createApiModule({});
