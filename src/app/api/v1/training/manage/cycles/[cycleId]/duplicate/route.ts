import { createApiModule } from "@/lib/api/handler";
import {
  type DuplicatedCycle,
  duplicateManagedCycle,
} from "@/lib/training/club-cycles";
import { createCycleRoute } from "@/lib/training/training-manage-api";

/**
 * Duplicar un ciclo (#904, RF-7 y D8 del PRD de E35): nace un borrador
 * "{nombre} (copy)" con copias de sus rutinas propias y sus filas, la
 * cuadrícula apuntando a las copias, las compartidas sin copiar, y sus notas
 * y dosis, en una sola transacción (`duplicate_training_cycle`). Responde la
 * lista, el id del nuevo y cuántas rutinas copió.
 */

// Depende de la sesión de quien llama y de los ciclos del club ahora.
export const dynamic = "force-dynamic";

export type DuplicatedCycleResponse = DuplicatedCycle;

export const POST = createCycleRoute<DuplicatedCycleResponse>({
  run: (gateways, { callerId, cycleId }) =>
    duplicateManagedCycle(gateways, { callerId, cycleId }),
});

export const { GET, PUT, PATCH, DELETE } = createApiModule({});
