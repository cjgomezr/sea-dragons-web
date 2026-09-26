import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  asNewsAttachmentApiError,
  readNewsAttachmentUpload,
  requireNewsAttachmentGateways,
} from "@/lib/news/news-attachments-api";
import type { NewsAttachmentSummary } from "@/lib/news/news-posts";
import { stageNewsUpload } from "@/lib/news/news-uploads";

/**
 * Subir un adjunto mientras se escribe la publicación (#330, RF-3 del PRD de
 * E11). El cuerpo son los bytes y `?name=` el nombre, como al subir a una
 * publicación ya creada (#328), con los mismos límites. Responde con el id
 * que después se manda al publicar.
 *
 * Cuelga de publicar, así que la frontera lo reserva a Admin y Committee, y
 * el dominio lo vuelve a comprobar.
 */

// Depende de la sesión de quien llama y escribe en el almacenamiento.
export const dynamic = "force-dynamic";

export type StagedNewsUploadResponse = NewsAttachmentSummary;

const postUpload = createApiRoute<StagedNewsUploadResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    const upload = await readNewsAttachmentUpload(request);
    try {
      return {
        data: await stageNewsUpload(requireNewsAttachmentGateways(), {
          callerId,
          ...upload,
        }),
        status: 201,
      };
    } catch (error) {
      asNewsAttachmentApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: postUpload,
});
