import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { readNewsPostId } from "@/lib/news/news-api";
import {
  type NewsAttachmentDownload,
  serveNewsAttachment,
} from "@/lib/news/news-attachments";
import {
  asNewsAttachmentApiError,
  readNewsAttachmentId,
  requireNewsAttachmentGateways,
} from "@/lib/news/news-attachments-api";

/**
 * Pedir un adjunto (#328, RF-3): una dirección firmada de vida corta con la
 * que descargarlo, para quien es la audiencia de la publicación.
 *
 * Quien no lo es recibe 404, igual que con la publicación, y también quien
 * pide el de una retirada. Un archivo que ya no está en el almacenamiento
 * responde 200 con `status: "unavailable"`: la pantalla avisa y sigue, no es
 * un error del servidor.
 */

// Depende de la sesión de quien llama, y cada dirección firmada caduca.
export const dynamic = "force-dynamic";

export type NewsAttachmentResponse = NewsAttachmentDownload;

type NewsAttachmentRouteContext = {
  readonly params: Promise<{
    readonly id: string;
    readonly attachmentId: string;
  }>;
};

export function GET(
  request: NextRequest,
  context: NewsAttachmentRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<NewsAttachmentResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const params = await context.params;
      const postId = readNewsPostId(params.id);
      const attachmentId = readNewsAttachmentId(params.attachmentId);
      try {
        return {
          data: await serveNewsAttachment(requireNewsAttachmentGateways(), {
            callerId,
            postId,
            attachmentId,
          }),
        };
      } catch (error) {
        asNewsAttachmentApiError(error);
      }
    },
  });
  return route(request);
}

export const { POST, PUT, PATCH, DELETE } = createApiModule({});
