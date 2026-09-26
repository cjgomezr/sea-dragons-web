import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { NO_CONTENT_STATUS } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { readNewsPostId } from "@/lib/news/news-api";
import { removeNewsAttachment } from "@/lib/news/news-attachments";
import {
  asNewsAttachmentApiError,
  readNewsAttachmentId,
  requireNewsAttachmentGateways,
} from "@/lib/news/news-attachments-api";

/**
 * Quitar un adjunto de una publicación propia (#328): borra su fila y su
 * archivo del almacenamiento. Sólo el autor, y la frontera sólo deja llegar
 * a Admin y Committee.
 */

// Depende de la sesión de quien llama y borra del almacenamiento.
export const dynamic = "force-dynamic";

type NewsAttachmentRouteContext = {
  readonly params: Promise<{
    readonly id: string;
    readonly attachmentId: string;
  }>;
};

export function DELETE(
  request: NextRequest,
  context: NewsAttachmentRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<never>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const params = await context.params;
      const postId = readNewsPostId(params.id);
      const attachmentId = readNewsAttachmentId(params.attachmentId);
      try {
        await removeNewsAttachment(requireNewsAttachmentGateways(), {
          callerId,
          postId,
          attachmentId,
        });
        return { status: NO_CONTENT_STATUS };
      } catch (error) {
        asNewsAttachmentApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, POST, PUT, PATCH } = createApiModule({});
