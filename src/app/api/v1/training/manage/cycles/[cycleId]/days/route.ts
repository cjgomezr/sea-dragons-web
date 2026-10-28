import { createApiModule } from "@/lib/api/handler";
import {
  type CycleDayChange,
  type ManagedCycleDetail,
  setManagedCycleDay,
} from "@/lib/training/club-cycles";
import {
  createCycleRoute,
  cycleDayBodySchema,
} from "@/lib/training/training-manage-api";

/**
 * Una ranura de un día de la cuadrícula (#904, RF-8 y D7 del PRD de E35):
 * con una rutina del ciclo o compartida, se guarda; con `routineId` nulo, se
 * vacía, y si se vacía la 1 con la 2 puesta, la 2 pasa a ser la 1. Una
 * rutina de otro ciclo es un 400. Responde el ciclo entero.
 */

// Depende de la sesión de quien llama y del ciclo ahora.
export const dynamic = "force-dynamic";

export type ManagedCycleDetailResponse = ManagedCycleDetail;

export const PUT = createCycleRoute<ManagedCycleDetailResponse, CycleDayChange>(
  {
    schema: cycleDayBodySchema,
    run: (gateways, { callerId, cycleId, body }) =>
      setManagedCycleDay(gateways, { callerId, cycleId, day: body }),
  },
);

export const { GET, POST, PATCH, DELETE } = createApiModule({});
