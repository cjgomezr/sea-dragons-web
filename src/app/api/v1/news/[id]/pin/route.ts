import type { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { NO_CONTENT_STATUS } from "@/lib/api/response";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  asNewsApiError,
  newsPinSchema,
  readNewsPostId,
  requireNewsGateways,
} from "@/lib/news/news-api";
import { pinNewsPost, unpinNewsPost } from "@/lib/news/news-pins";
import type { NewsPostDetail } from "@/lib/news/news-posts";

/**
 * Fijar y desfijar una publicación (#592, RF-3 del PRD de E22). POST con
 * `{ until }` la fija hasta esa fecha, o sin fecha de fin con `null`, y quita
 * la que estuviera fijada. DELETE la desfija y responde 204, también si no
 * estaba fijada.
 *
 * Solo el Admin (D1): a cualquier otro rol, 403. Una retirada no se fija:
 * 409 con el motivo `news_post_withdrawn`. Una fecha pasada o mal formada,
 * 400. La caducidad no la quita nadie: se calcula al leer (D7).
 */

// Depende de la sesión de quien llama y escribe en la publicación.
export const dynamic = "force-dynamic";

/** La publicación fijada, como la abriría el Admin que la fijó. */
export type PinnedNewsPostResponse = NewsPostDetail;

type NewsPinBody = z.infer<typeof newsPinSchema>;

type NewsPostPinRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export function POST(
  request: NextRequest,
  context: NewsPostPinRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<PinnedNewsPostResponse, NewsPinBody>({
    schema: newsPinSchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const postId = readNewsPostId((await context.params).id);
      try {
        return {
          data: await pinNewsPost(requireNewsGateways(), {
            callerId,
            postId,
            until: body.until,
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

export function DELETE(
  request: NextRequest,
  context: NewsPostPinRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<never>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const postId = readNewsPostId((await context.params).id);
      try {
        await unpinNewsPost(requireNewsGateways(), { callerId, postId });
        return { status: NO_CONTENT_STATUS };
      } catch (error) {
        asNewsApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, PUT, PATCH } = createApiModule({});
