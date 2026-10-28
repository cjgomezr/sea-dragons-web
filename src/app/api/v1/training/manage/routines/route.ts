import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { CycleNotFoundError } from "@/lib/training/club-cycles";
import {
  type ManagedRoutineResult,
  type ManagedRoutines,
  type RoutineListScope,
  createClubRoutine,
  listClubRoutines,
} from "@/lib/training/club-routines";
import {
  asTrainingManageApiError,
  readRouteId,
  requireClubRoutinesGateways,
  routineCreateBodySchema,
} from "@/lib/training/training-manage-api";

/**
 * Las rutinas en Planificar (#905, RF-9 y D8 del PRD de E35). GET con
 * `?cycle={id}` devuelve las de ese ciclo y después las compartidas, y con
 * `?scope=shared` sólo las compartidas: no hay "todas". Cada una lleva su
 * color, sus filas y en cuántos días se usa en todos los ciclos. POST crea
 * una en un ciclo, o compartida sin él, con el color siguiente de la paleta.
 */

// Depende de la sesión de quien llama y de las rutinas del club ahora.
export const dynamic = "force-dynamic";

export type ManagedRoutinesResponse = ManagedRoutines;

export type ManagedRoutineResponse = ManagedRoutineResult;

const CYCLE_PARAM = "cycle";
const SCOPE_PARAM = "scope";
const SHARED_SCOPE = "shared";

type RoutineCreateBody = {
  readonly name: string;
  readonly cycleId?: string | null;
};

/** Uno de los dos, nunca ninguno ni ambos. */
function readListScope(searchParams: URLSearchParams): RoutineListScope {
  const cycle = searchParams.get(CYCLE_PARAM);
  const scope = searchParams.get(SCOPE_PARAM);
  if (cycle !== null && scope === null) {
    return {
      kind: "cycle",
      cycleId: readRouteId(cycle, new CycleNotFoundError()),
    };
  }
  if (cycle === null && scope === SHARED_SCOPE) {
    return { kind: "shared" };
  }
  throw new ApiError(
    "validation_error",
    `Pide "${CYCLE_PARAM}={id}" o "${SCOPE_PARAM}=${SHARED_SCOPE}".`,
  );
}

const getRoutines = createApiRoute<ManagedRoutinesResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    const scope = readListScope(request.nextUrl.searchParams);
    try {
      return {
        data: await listClubRoutines(requireClubRoutinesGateways(), {
          callerId,
          scope,
        }),
      };
    } catch (error) {
      return asTrainingManageApiError(error);
    }
  },
});

const postRoutine = createApiRoute<ManagedRoutineResponse, RoutineCreateBody>({
  schema: routineCreateBodySchema,
  handler: async ({ request, body, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await createClubRoutine(requireClubRoutinesGateways(), {
          callerId,
          cycleId: body.cycleId ?? null,
          name: body.name,
        }),
        status: 201,
      };
    } catch (error) {
      return asTrainingManageApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getRoutines,
  POST: postRoutine,
});
