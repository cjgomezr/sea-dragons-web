import { createApiModule } from "@/lib/api/handler";
import {
  type ManagedCycles,
  archiveManagedCycle,
} from "@/lib/training/club-cycles";
import { createCycleRoute } from "@/lib/training/training-manage-api";

/**
 * Archivar un ciclo (#904, RF-7 del PRD de E35). Responde la lista entera.
 */

// Depende de la sesión de quien llama y de los ciclos del club ahora.
export const dynamic = "force-dynamic";

export type ManagedCyclesResponse = ManagedCycles;

export const POST = createCycleRoute<ManagedCyclesResponse>({
  run: (gateways, { callerId, cycleId }) =>
    archiveManagedCycle(gateways, { callerId, cycleId }),
});

export const { GET, PUT, PATCH, DELETE } = createApiModule({});
