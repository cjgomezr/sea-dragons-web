import { createApiModule } from "@/lib/api/handler";
import {
  type ManagedCycleDetail,
  copyManagedCycleWeekOne,
} from "@/lib/training/club-cycles";
import { createCycleRoute } from "@/lib/training/training-manage-api";

/**
 * Copiar la semana 1 (#904, RF-8 del PRD de E35): sus días pasan a las
 * semanas 2 a N − 2 y las dos últimas no cambian. Con menos de 4 semanas,
 * 400. Responde el ciclo entero.
 */

// Depende de la sesión de quien llama y del ciclo ahora.
export const dynamic = "force-dynamic";

export type ManagedCycleDetailResponse = ManagedCycleDetail;

export const POST = createCycleRoute<ManagedCycleDetailResponse>({
  run: (gateways, { callerId, cycleId }) =>
    copyManagedCycleWeekOne(gateways, { callerId, cycleId }),
});

export const { GET, PUT, PATCH, DELETE } = createApiModule({});
