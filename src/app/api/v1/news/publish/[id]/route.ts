import type { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  asNewsApiError,
  newsEditSchema,
  readNewsPostId,
  requireNewsGateways,
} from "@/lib/news/news-api";
import {
  type EditableNewsPost,
  editNewsPost,
  readEditableNewsPost,
} from "@/lib/news/news-management";
import type { NewsPostDetail } from "@/lib/news/news-posts";

/**
 * Editar una publicación (#331, RF-6 del PRD de E11). GET da lo que carga el
 * formulario: la audiencia entera y la marca de editada. PATCH guarda
 * categoría, título, cuerpo y audiencia, y responde 409 si alguien guardó
 * entretanto: `expectedEditedAt` es la marca que se tenía delante, `null` si
 * nunca se editó. Editar no avisa a nadie (decisión D2).
 *
 * La frontera lo reserva a Admin y Committee. El dominio exige además que la
 * publicación sea de quien llama, salvo al Admin, y responde 403 si no.
 */

// Depende de la sesión de quien llama y de la publicación ahora.
export const dynamic = "force-dynamic";

export type EditableNewsPostResponse = EditableNewsPost;

/** La publicación editada, como la abriría quien la editó. */
export type EditedNewsPostResponse = NewsPostDetail;

type NewsEditBody = z.infer<typeof newsEditSchema>;

type NewsPostManageRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export function GET(
  request: NextRequest,
  context: NewsPostManageRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<EditableNewsPostResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const postId = readNewsPostId((await context.params).id);
      try {
        return {
          data: await readEditableNewsPost(requireNewsGateways(), {
            callerId,
            postId,
          }),
        };
      } catch (error) {
        asNewsApiError(error);
      }
    },
  });
  return route(request);
}

export function PATCH(
  request: NextRequest,
  context: NewsPostManageRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<EditedNewsPostResponse, NewsEditBody>({
    schema: newsEditSchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const postId = readNewsPostId((await context.params).id);
      const { expectedEditedAt, ...draft } = body;
      try {
        return {
          data: await editNewsPost(requireNewsGateways(), {
            callerId,
            postId,
            draft,
            expectedEditedAt,
            now: new Date(),
          }),
        };
      } catch (error) {
        asNewsApiError(error);
      }
    },
  });
  return route(request);
}

export const { POST, PUT, DELETE } = createApiModule({});
