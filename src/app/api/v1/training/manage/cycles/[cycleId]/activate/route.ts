import { createApiModule } from "@/lib/api/handler";
import {
  type ManagedCycles,
  activateManagedCycle,
} from "@/lib/training/club-cycles";
import { createCycleRoute } from "@/lib/training/training-manage-api";

/**
 * Activar un ciclo (#904, RF-7 y D5 del PRD de E35): pasa a activo y el que
 * lo era, a archivado, en una sola transacción (`activate_training_cycle`).
 * Responde la lista entera, porque cambian dos tarjetas.
 */

// Depende de la sesión de quien llama y de los ciclos del club ahora.
export const dynamic = "force-dynamic";

export type ManagedCyclesResponse = ManagedCycles;

export const POST = createCycleRoute<ManagedCyclesResponse>({
  run: (gateways, { callerId, cycleId }) =>
    activateManagedCycle(gateways, { callerId, cycleId }),
});

export const { GET, PUT, PATCH, DELETE } = createApiModule({});
