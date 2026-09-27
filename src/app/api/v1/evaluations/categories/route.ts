import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  createEvaluationCategory,
  listEvaluationCategories,
} from "@/lib/evaluations/evaluation-categories";
import {
  type EvaluationCategoriesResponse,
  asCategoriesApiError,
  categoryNameSchema,
  requireEvaluationCategoriesGateways,
} from "@/lib/evaluations/evaluation-categories-api";

/**
 * El catálogo de categorías del club (#320, RF-3 del PRD de E9): GET las
 * lista todas, desactivadas incluidas, y POST añade una, que entra en las
 * evaluaciones que se creen a partir de ahora y en ninguna guardada.
 *
 * Quién puede llamarlo lo decide la frontera: cuelga de
 * `EVALUATIONS_API_PATH`, reservado a Admin y Coach, y el dominio lo vuelve a
 * comprobar. El club sale de la fila de quien llama, nunca de un parámetro
 * (NFR-009).
 */

// Depende de la sesión de quien llama y del catálogo del club ahora.
export const dynamic = "force-dynamic";

const CREATED_STATUS = 201;

const createBodySchema = z.object({ name: categoryNameSchema }).strict();

type CreateBody = z.infer<typeof createBodySchema>;

const getCategories = createApiRoute<EvaluationCategoriesResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: {
          categories: await listEvaluationCategories(
            requireEvaluationCategoriesGateways(),
            callerId,
          ),
        },
      };
    } catch (error) {
      asCategoriesApiError(error);
    }
  },
});

const postCategory = createApiRoute<EvaluationCategoriesResponse, CreateBody>({
  schema: createBodySchema,
  handler: async ({ request, body, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      const categories = await createEvaluationCategory(
        requireEvaluationCategoriesGateways(),
        { callerId, name: body.name },
      );
      return { data: { categories }, status: CREATED_STATUS };
    } catch (error) {
      asCategoriesApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getCategories,
  POST: postCategory,
});
