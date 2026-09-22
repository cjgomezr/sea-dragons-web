import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError, NO_CONTENT_STATUS } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { requireNotificationMarker } from "@/lib/notifications/notifications-api";

/**
 * Marcar un aviso de quien llama como leído (#265, RF-5 del PRD de E6).
 * Marcarlo otra vez responde igual y no mueve su fecha de lectura. El aviso
 * de otro socio responde como uno que no existe: quien llama no tiene por qué
 * saber que existe.
 */

// Depende de la sesión de quien llama y del estado del aviso ahora.
export const dynamic = "force-dynamic";

type ReadRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

const NOT_FOUND_MESSAGE = "No tienes ningún aviso con ese id.";

/** Un id que no es un uuid no puede nombrar ningún aviso: se responde como
 * uno que no existe, sin mandarle a Postgres un valor que rechazaría. */
function parseNotificationId(id: string): string {
  if (!z.uuid().safeParse(id).success) {
    throw new ApiError("not_found", NOT_FOUND_MESSAGE);
  }
  return id;
}

export function POST(
  request: NextRequest,
  context: ReadRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<never>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const userId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const notificationId = parseNotificationId((await context.params).id);
      const outcome = await requireNotificationMarker().markRead({
        userId,
        notificationId,
      });
      if (outcome === "not_found") {
        throw new ApiError("not_found", NOT_FOUND_MESSAGE);
      }
      return { status: NO_CONTENT_STATUS };
    },
  });
  return route(request);
}

export const { GET, PUT, PATCH, DELETE } = createApiModule({});
