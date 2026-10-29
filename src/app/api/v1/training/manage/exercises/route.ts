import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { readClubExerciseForm } from "@/lib/training/club-exercise-form";
import {
  type ExerciseSource,
  type ManagedExercise,
  type ManagedExercises,
  createClubExercise,
  searchExercises,
} from "@/lib/training/club-exercises";
import {
  asTrainingManageApiError,
  requireClubExercisesGateways,
} from "@/lib/training/training-manage-api";

/**
 * Los ejercicios en Planificar (#903, RF-10 y D13 del PRD de E35). GET busca
 * con `?q=` hasta 20 de la biblioteca y del club, sin mayúsculas ni acentos,
 * cada uno con su origen, su miniatura y las rutinas que lo usan; sin `q`,
 * los primeros. Para la lista de Planificar → Ejercicios (#910), `?source=`
 * (`library` o `club`) se queda con un origen y `?offset=` pide la página
 * que empieza ahí; la respuesta trae cuántos casan de cada origen y el
 * `nextOffset` de la página siguiente. POST crea uno del club con un formulario multipart (ver
 * `club-exercise-form.ts`) y responde 201. La frontera los reserva a Admin y
 * Coach, y el dominio lo vuelve a comprobar.
 */

// Depende de la sesión de quien llama y de los ejercicios del club ahora.
export const dynamic = "force-dynamic";

export type ManagedExercisesResponse = ManagedExercises;
export type ManagedExerciseResponse = ManagedExercise;

const QUERY_PARAM = "q";
const SOURCE_PARAM = "source";
const OFFSET_PARAM = "offset";

const SOURCES: ReadonlySet<string> = new Set<ExerciseSource>([
  "library",
  "club",
]);

function isExerciseSource(value: string): value is ExerciseSource {
  return SOURCES.has(value);
}

function readSource(params: URLSearchParams): ExerciseSource | null {
  const source = params.get(SOURCE_PARAM);
  if (source === null) {
    return null;
  }
  if (!isExerciseSource(source)) {
    throw new ApiError("validation_error", '"source" es "library" o "club".');
  }
  return source;
}

function readOffset(params: URLSearchParams): number {
  const offset = params.get(OFFSET_PARAM);
  if (offset === null) {
    return 0;
  }
  if (!/^\d+$/.test(offset)) {
    throw new ApiError("validation_error", '"offset" es un entero desde 0.');
  }
  return Number(offset);
}

const getExercises = createApiRoute<ManagedExercisesResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    const params = request.nextUrl.searchParams;
    const query = params.get(QUERY_PARAM) ?? "";
    const source = readSource(params);
    const offset = readOffset(params);
    try {
      return {
        data: await searchExercises(requireClubExercisesGateways(), {
          callerId,
          query,
          source,
          offset,
        }),
      };
    } catch (error) {
      return asTrainingManageApiError(error);
    }
  },
});

const postExercise = createApiRoute<ManagedExerciseResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      const form = await readClubExerciseForm(request, "create");
      return {
        data: await createClubExercise(requireClubExercisesGateways(), {
          callerId,
          ...form,
        }),
        status: 201,
      };
    } catch (error) {
      return asTrainingManageApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getExercises,
  POST: postExercise,
});
