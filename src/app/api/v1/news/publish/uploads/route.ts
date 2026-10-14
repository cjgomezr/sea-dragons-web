import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  type NewsUploadKind,
  asNewsAttachmentApiError,
  readNewsAttachmentUpload,
  readNewsUploadKind,
  requireNewsAttachmentGateways,
} from "@/lib/news/news-attachments-api";
import { stageNewsCover } from "@/lib/news/news-cover-uploads";
import { stageNewsInlineImage } from "@/lib/news/news-inline-images";
import type { NewsAttachmentSummary } from "@/lib/news/news-posts";
import { stageNewsUpload } from "@/lib/news/news-uploads";

/**
 * Subir un adjunto mientras se escribe la publicación (#330, RF-3 del PRD de
 * E11). El cuerpo son los bytes y `?name=` el nombre, como al subir a una
 * publicación ya creada (#328), con los mismos límites. Responde con el id
 * que después se manda al publicar.
 *
 * Con `?kind=cover` es la portada (#591): JPEG, PNG o WebP de hasta 10 MB,
 * que se guarda reducida a dos WebP y cuyo id va en `coverUploadId`.
 *
 * Con `?kind=inline_image` es una imagen del cuerpo (#603), con los mismos
 * tipos y tope, reducida a un WebP. Su id va en el cuerpo, dentro de
 * `/api/v1/news/images/{id}`, y guardar la publicación la liga a ella.
 *
 * Cuelga de publicar, así que la frontera lo reserva a Admin y Committee, y
 * el dominio lo vuelve a comprobar.
 */

// Depende de la sesión de quien llama y escribe en el almacenamiento.
export const dynamic = "force-dynamic";

export type StagedNewsUploadResponse = NewsAttachmentSummary;

/** Las tres reciben y devuelven lo mismo; cambia qué se guarda. */
const STAGERS: Readonly<Record<NewsUploadKind, typeof stageNewsUpload>> = {
  attachment: stageNewsUpload,
  cover: stageNewsCover,
  inline_image: stageNewsInlineImage,
};

const postUpload = createApiRoute<StagedNewsUploadResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    const kind = readNewsUploadKind(request);
    const upload = await readNewsAttachmentUpload(request, kind);
    const stage = STAGERS[kind];
    try {
      return {
        data: await stage(requireNewsAttachmentGateways(), {
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
