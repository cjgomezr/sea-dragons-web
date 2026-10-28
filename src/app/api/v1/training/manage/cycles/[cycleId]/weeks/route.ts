import { createApiModule } from "@/lib/api/handler";
import {
  type CycleWeekRecord,
  type ManagedCycleDetail,
  saveManagedCycleWeek,
} from "@/lib/training/club-cycles";
import {
  createCycleRoute,
  cycleWeekBodySchema,
} from "@/lib/training/training-manage-api";

/**
 * La nota y la dosis de una semana (#904, RF-8 y D6 del PRD de E35): nota de
 * hasta 140; dosis con series de 1 a 99, repeticiones de hasta 20 caracteres
 * e intensidad `none`, `pct` de 1 a 150 o `text` de hasta 20. Responde el
 * ciclo entero.
 */

// Depende de la sesión de quien llama y del ciclo ahora.
export const dynamic = "force-dynamic";

export type ManagedCycleDetailResponse = ManagedCycleDetail;

export const PUT = createCycleRoute<
  ManagedCycleDetailResponse,
  CycleWeekRecord
>({
  schema: cycleWeekBodySchema,
  run: (gateways, { callerId, cycleId, body }) =>
    saveManagedCycleWeek(gateways, { callerId, cycleId, week: body }),
});

export const { GET, POST, PATCH, DELETE } = createApiModule({});
