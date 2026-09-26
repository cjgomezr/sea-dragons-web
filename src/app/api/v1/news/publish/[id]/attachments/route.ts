import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { readNewsPostId } from "@/lib/news/news-api";
import { attachNewsFile } from "@/lib/news/news-attachments";
import {
  asNewsAttachmentApiError,
  readNewsAttachmentUpload,
  requireNewsAttachmentGateways,
} from "@/lib/news/news-attachments-api";
import type { NewsAttachmentSummary } from "@/lib/news/news-posts";

/**
 * Subir un adjunto a una publicación propia (#328, RF-3 del PRD de E11,
 * FR-058). El cuerpo son los bytes del archivo y `?name=` el nombre con el
 * que se subió. PDF, imagen o Word, hasta 10 MB y hasta 5 por publicación; el
 * tipo se comprueba por el contenido.
 *
 * La frontera lo reserva a Admin y Committee porque cuelga de publicar, y el
 * dominio exige además ser el autor: en una publicación ajena responde 404.
 */

// Depende de la sesión de quien llama y escribe en el almacenamiento.
export const dynamic = "force-dynamic";

type NewsAttachmentsRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export type UploadedNewsAttachmentResponse = NewsAttachmentSummary;

export function POST(
  request: NextRequest,
  context: NewsAttachmentsRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<UploadedNewsAttachmentResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const postId = readNewsPostId((await context.params).id);
      const upload = await readNewsAttachmentUpload(apiRequest);
      try {
        return {
          data: await attachNewsFile(requireNewsAttachmentGateways(), {
            callerId,
            postId,
            ...upload,
          }),
          status: 201,
        };
      } catch (error) {
        asNewsAttachmentApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, PUT, PATCH, DELETE } = createApiModule({});
