import type { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { newsDraftSchema } from "@/lib/news/news-api";
import {
  asNewsAttachmentApiError,
  requireNewsPublishGateways,
} from "@/lib/news/news-attachments-api";
import type { NewsPostDetail } from "@/lib/news/news-posts";
import { publishNewsPostWithUploads } from "@/lib/news/news-uploads";

/**
 * Publicar (#327, RF-2 del PRD de E11, FR-057): categoría, título, cuerpo y
 * audiencia, que es todo el club o al menos un grupo del club. Con
 * `attachmentUploadIds`, los adjuntos que se subieron mientras se escribía
 * (#330) quedan ligados a la publicación; sin ellos, sale sin adjuntos.
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
    const { attachmentUploadIds, ...draft } = body;
    try {
      return {
        data: await publishNewsPostWithUploads(requireNewsPublishGateways(), {
          callerId,
          draft,
          uploadIds: attachmentUploadIds,
          now: new Date(),
        }),
        status: 201,
      };
    } catch (error) {
      asNewsAttachmentApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: postNews,
});
