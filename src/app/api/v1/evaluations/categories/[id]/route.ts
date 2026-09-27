import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  renameEvaluationCategory,
  setEvaluationCategoryActive,
} from "@/lib/evaluations/evaluation-categories";
import {
  type EvaluationCategoriesResponse,
  asCategoriesApiError,
  categoryNameSchema,
  readCategoryId,
  requireEvaluationCategoriesGateways,
} from "@/lib/evaluations/evaluation-categories-api";

/**
 * Renombrar, desactivar o reactivar una categoría del club (#320). Un PATCH
 * hace una sola cosa: trae `name` o trae `isActive`, nunca los dos.
 *
 * Renombrar se ve en todas las evaluaciones que la usan; desactivar no la
 * quita de ninguna guardada (AC-035). El `[id]` sólo alcanza a las del club
 * de quien llama: la de otro club responde 404, como una que no existe.
 */

// Depende de la sesión de quien llama y de la categoría ahora.
export const dynamic = "force-dynamic";

const changeBodySchema = z.union([
  z.object({ name: categoryNameSchema }).strict(),
  z.object({ isActive: z.boolean() }).strict(),
]);

type ChangeBody = z.infer<typeof changeBodySchema>;

type CategoryRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export function PATCH(
  request: NextRequest,
  context: CategoryRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<EvaluationCategoriesResponse, ChangeBody>({
    schema: changeBodySchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const categoryId = readCategoryId((await context.params).id);
      const gateways = requireEvaluationCategoriesGateways();
      try {
        const categories =
          "name" in body
            ? await renameEvaluationCategory(gateways, {
                callerId,
                categoryId,
                name: body.name,
              })
            : await setEvaluationCategoryActive(gateways, {
                callerId,
                categoryId,
                isActive: body.isActive,
              });
        return { data: { categories } };
      } catch (error) {
        asCategoriesApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, POST, PUT, DELETE } = createApiModule({});
