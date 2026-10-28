import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { readClubExerciseForm } from "@/lib/training/club-exercise-form";
import {
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
 * los primeros. POST crea uno del club con un formulario multipart (ver
 * `club-exercise-form.ts`) y responde 201. La frontera los reserva a Admin y
 * Coach, y el dominio lo vuelve a comprobar.
 */

// Depende de la sesión de quien llama y de los ejercicios del club ahora.
export const dynamic = "force-dynamic";

export type ManagedExercisesResponse = ManagedExercises;
export type ManagedExerciseResponse = ManagedExercise;

const QUERY_PARAM = "q";

const getExercises = createApiRoute<ManagedExercisesResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    const query = request.nextUrl.searchParams.get(QUERY_PARAM) ?? "";
    try {
      return {
        data: await searchExercises(requireClubExercisesGateways(), {
          callerId,
          query,
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
