import { createApiModule } from "@/lib/api/handler";
import {
  type ManagedCycles,
  activateManagedCycle,
} from "@/lib/training/club-cycles";
import {
  createCycleRoute,
  readConfirm,
} from "@/lib/training/training-manage-api";

/**
 * Activar un ciclo (#904; #978, D2 y D3 del PRD de E38). Puede haber varios
 * activos mientras no se solapen: uno de todo el club y, por grupo, uno que
 * lo incluya. Si choca con otros activos, sin `?confirm=true` responde 409
 * `cycle_conflicts` con la lista (`id` y `name`) y no cambia nada; con él,
 * los archiva y activa este en una sola transacción
 * (`activate_training_cycle`). Responde la lista entera, porque pueden
 * cambiar varias tarjetas.
 */

// Depende de la sesión de quien llama y de los ciclos del club ahora.
export const dynamic = "force-dynamic";

export type ManagedCyclesResponse = ManagedCycles;

export const POST = createCycleRoute<ManagedCyclesResponse>({
  run: (gateways, { callerId, cycleId, searchParams }) =>
    activateManagedCycle(gateways, {
      callerId,
      cycleId,
      confirm: readConfirm(searchParams),
    }),
});

export const { GET, PUT, PATCH, DELETE } = createApiModule({});
