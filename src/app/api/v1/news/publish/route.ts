import type { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  asNewsApiError,
  newsDraftSchema,
  requireNewsGateways,
} from "@/lib/news/news-api";
import { type NewsPostDetail, publishNewsPost } from "@/lib/news/news-posts";

/**
 * Publicar (#327, RF-2 del PRD de E11, FR-057): categoría, título, cuerpo y
 * audiencia, que es todo el club o al menos un grupo del club.
 *
 * Quién puede llamarlo lo decide la frontera: `RESTRICTED_ROUTES` lo reserva
 * a Admin y Committee, y el dominio lo vuelve a comprobar. El autor y el club
 * salen de la sesión, nunca del cuerpo.
 */

// Depende de la sesión de quien llama.
export const dynamic = "force-dynamic";

type NewsDraftBody = z.infer<typeof newsDraftSchema>;

/** La publicación recién guardada, como la abriría quien la publicó. */
export type PublishedNewsPostResponse = NewsPostDetail;

const postNews = createApiRoute<PublishedNewsPostResponse, NewsDraftBody>({
  schema: newsDraftSchema,
  handler: async ({ request, body, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await publishNewsPost(requireNewsGateways(), {
          callerId,
          draft: body,
        }),
        status: 201,
      };
    } catch (error) {
      asNewsApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: postNews,
});
