import type { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  asNewsApiError,
  newsStatusSchema,
  readNewsPostId,
  requireNewsGateways,
} from "@/lib/news/news-api";
import { changeNewsPostStatus } from "@/lib/news/news-management";
import type { NewsPostDetail } from "@/lib/news/news-posts";

/**
 * Retirar o volver a publicar (#331, RF-6 del PRD de E11): PUT con
 * `{ status: "withdrawn" }` o `{ status: "published" }`. Retirar oculta y no
 * borra (decisión D1); volver a publicar no avisa a nadie (decisión D2).
 *
 * La frontera lo reserva a Admin y Committee. El dominio exige además que la
 * publicación sea de quien llama, salvo al Admin, y responde 403 si no.
 */

// Depende de la sesión de quien llama y escribe en la publicación.
export const dynamic = "force-dynamic";

/** La publicación con su estado nuevo, como la abriría quien la cambió. */
export type NewsPostStatusResponse = NewsPostDetail;

type NewsStatusBody = z.infer<typeof newsStatusSchema>;

type NewsPostStatusRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export function PUT(
  request: NextRequest,
  context: NewsPostStatusRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<NewsPostStatusResponse, NewsStatusBody>({
    schema: newsStatusSchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const postId = readNewsPostId((await context.params).id);
      try {
        return {
          data: await changeNewsPostStatus(requireNewsGateways(), {
            callerId,
            postId,
            status: body.status,
          }),
        };
      } catch (error) {
        asNewsApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, POST, PATCH, DELETE } = createApiModule({});
