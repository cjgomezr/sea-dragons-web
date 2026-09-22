import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { NO_CONTENT_STATUS } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { requireNotificationMarker } from "@/lib/notifications/notifications-api";

/**
 * Marcar todos los avisos de quien llama como leídos (#265, RF-5 del PRD de
 * E6, FR-075, AC-030). Actúa siempre sobre quien identifica la cookie, nunca
 * sobre un id del cuerpo. Escribe con la llave de servicio, porque
 * `authenticated` no puede escribir en la tabla.
 */

// Depende de la sesión de quien llama.
export const dynamic = "force-dynamic";

const postReadAll = createApiRoute<never>({
  handler: async ({ request, decorateResponse }) => {
    const userId = await identifyAccountCaller({ request, decorateResponse });
    await requireNotificationMarker().markAllRead(userId);
    return { status: NO_CONTENT_STATUS };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: postReadAll,
});
