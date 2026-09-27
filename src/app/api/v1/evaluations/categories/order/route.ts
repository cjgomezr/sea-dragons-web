import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { reorderEvaluationCategories } from "@/lib/evaluations/evaluation-categories";
import {
  type EvaluationCategoriesResponse,
  asCategoriesApiError,
  requireEvaluationCategoriesGateways,
} from "@/lib/evaluations/evaluation-categories-api";

/**
 * Reordenar las categorías del club (#320): PUT con la lista entera de las
 * activas en el orden nuevo, no un movimiento por petición. Si alguien
 * cambió las activas entretanto, responde 409 y no toca nada.
 */

// Depende de la sesión de quien llama y del catálogo del club ahora.
export const dynamic = "force-dynamic";

/** Un tope holgado: ningún club mide tantas cosas. */
const MAX_CATEGORIES_IN_ORDER = 200;

const orderBodySchema = z
  .object({
    categoryIds: z.array(z.uuid()).min(1).max(MAX_CATEGORIES_IN_ORDER),
  })
  .strict();

type OrderBody = z.infer<typeof orderBodySchema>;

const putOrder = createApiRoute<EvaluationCategoriesResponse, OrderBody>({
  schema: orderBodySchema,
  handler: async ({ request, body, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      const categories = await reorderEvaluationCategories(
        requireEvaluationCategoriesGateways(),
        { callerId, categoryIds: body.categoryIds },
      );
      return { data: { categories } };
    } catch (error) {
      asCategoriesApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  PUT: putOrder,
});
