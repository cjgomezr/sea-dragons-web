import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { asNewsApiError, requireNewsGateways } from "@/lib/news/news-api";
import {
  NewsInlineImageNotFoundError,
  serveNewsInlineImage,
} from "@/lib/news/news-inline-images";
import { readNewsAttachmentId } from "@/lib/news/news-attachments-api";

/**
 * La dirección estable de una imagen del cuerpo de una noticia (#603, RF-14
 * del PRD de E22). Es la que el cuerpo guarda: redirige a una dirección
 * firmada de vida corta a quien puede verla, y responde 404 a todo lo demás
 * (fuera de la audiencia, publicación retirada, imagen quitada al editar).
 *
 * Antes de publicar, la imagen sólo la ve quien la subió: así se pinta en la
 * Vista previa con la misma dirección que tendrá publicada.
 */

// Depende de la sesión de quien llama, y cada dirección firmada caduca.
export const dynamic = "force-dynamic";

/** Cinco minutos: lo que el navegador reutiliza la redirección (y con ella
 * la imagen ya descargada) al volver a la publicación. Menos que la vida de
 * la firmada, para que nunca redirija a una que ya caducó. */
const REDIRECT_MAX_AGE_SECONDS = 5 * 60;

type NewsInlineImageRouteContext = {
  readonly params: Promise<{ readonly imageId: string }>;
};

export function GET(
  request: NextRequest,
  context: NewsInlineImageRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<never>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const imageId = readNewsAttachmentId((await context.params).imageId);
      try {
        const url = await serveNewsInlineImage(requireNewsGateways(), {
          callerId,
          imageId,
        });
        return {
          redirect: { url, maxAgeSeconds: REDIRECT_MAX_AGE_SECONDS },
        };
      } catch (error) {
        if (error instanceof NewsInlineImageNotFoundError) {
          throw new ApiError("not_found", error.message);
        }
        asNewsApiError(error);
      }
    },
  });
  return route(request);
}

export const { POST, PUT, PATCH, DELETE } = createApiModule({});
