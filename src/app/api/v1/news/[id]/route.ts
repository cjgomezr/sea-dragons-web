import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  asNewsApiError,
  readNewsPostId,
  requireNewsGateways,
} from "@/lib/news/news-api";
import { type NewsPostDetail, openNewsPost } from "@/lib/news/news-posts";

/**
 * Una publicación abierta (#327, RF-5 del PRD de E11): el cuerpo entero, su
 * autor, su fecha, si se editó y sus adjuntos.
 *
 * Quien no es su audiencia recibe 404, no 403, igual que con la de otro club
 * o la retirada. Es deliberado: con un 403 distinto del 404 se podría recorrer
 * ids y enumerar qué publicaciones existen. Sólo quien la publicó abre la
 * retirada, marcada como tal.
 */

// Depende de la sesión de quien llama y de la publicación ahora.
export const dynamic = "force-dynamic";

export type NewsPostResponse = NewsPostDetail;

type NewsPostRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export function GET(
  request: NextRequest,
  context: NewsPostRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<NewsPostResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const postId = readNewsPostId((await context.params).id);
      try {
        return {
          data: await openNewsPost(requireNewsGateways(), { callerId, postId }),
        };
      } catch (error) {
        asNewsApiError(error);
      }
    },
  });
  return route(request);
}

export const { POST, PUT, PATCH, DELETE } = createApiModule({});
