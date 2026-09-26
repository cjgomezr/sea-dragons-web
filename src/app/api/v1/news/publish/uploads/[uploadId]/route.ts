import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { NO_CONTENT_STATUS } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  asNewsAttachmentApiError,
  readNewsAttachmentId,
  requireNewsAttachmentGateways,
} from "@/lib/news/news-attachments-api";
import { discardNewsUpload } from "@/lib/news/news-uploads";

/**
 * Quitar un adjunto subido antes de publicar (#330): lo borra del
 * almacenamiento. Sólo busca entre las subidas de quien llama, así que la de
 * otra persona responde 404.
 */

// Depende de la sesión de quien llama y borra del almacenamiento.
export const dynamic = "force-dynamic";

type NewsUploadRouteContext = {
  readonly params: Promise<{ readonly uploadId: string }>;
};

export function DELETE(
  request: NextRequest,
  context: NewsUploadRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<never>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const uploadId = readNewsAttachmentId((await context.params).uploadId);
      try {
        await discardNewsUpload(requireNewsAttachmentGateways(), {
          callerId,
          uploadId,
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
