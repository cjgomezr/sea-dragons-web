import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  type CycleInput,
  type ManagedCycleDetail,
  type ManagedCycles,
  createManagedCycle,
  listManagedCycles,
} from "@/lib/training/club-cycles";
import {
  asTrainingManageApiError,
  cycleBodySchema,
  requireClubCyclesGateways,
} from "@/lib/training/training-manage-api";

/**
 * Los ciclos del club en Planificar (#904, RF-7 y D5 del PRD de E35): GET
 * los lista con su estado, fechas, semanas y rutinas propias, y POST crea un
 * borrador. Con evento, la semana 1 empieza el lunes de la semana del evento
 * menos (N − 1) semanas; sin él, el lunes de la fecha de inicio. La frontera
 * lo reserva a Admin y Coach, y el dominio lo vuelve a comprobar.
 */

// Depende de la sesión de quien llama y de los ciclos del club ahora.
export const dynamic = "force-dynamic";

export type ManagedCyclesResponse = ManagedCycles;
export type ManagedCycleDetailResponse = ManagedCycleDetail;

const getCycles = createApiRoute<ManagedCyclesResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await listManagedCycles(requireClubCyclesGateways(), callerId),
      };
    } catch (error) {
      return asTrainingManageApiError(error);
    }
  },
});

const postCycle = createApiRoute<ManagedCycleDetailResponse, CycleInput>({
  schema: cycleBodySchema,
  handler: async ({ request, body, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await createManagedCycle(requireClubCyclesGateways(), {
          callerId,
          input: body,
        }),
        status: 201,
      };
    } catch (error) {
      return asTrainingManageApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getCycles,
  POST: postCycle,
});
