import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { openAccountSession } from "@/lib/auth/account-api";
import { createSupabaseNotificationReader } from "@/lib/notifications/supabase-notification-gateways";

/**
 * Cuántos avisos sin leer tiene quien llama (#265, RF-4 del PRD de E6): el
 * número de la campana. Se pide cada minuto por cada socio conectado, así que
 * es una sola consulta de conteo, con la sesión de quien llama.
 */

// Depende de la sesión de quien llama y de sus avisos en este instante.
export const dynamic = "force-dynamic";

export type UnreadNotificationsCountResponse = {
  readonly unreadCount: number;
};

const getUnreadCount = createApiRoute<UnreadNotificationsCountResponse>({
  handler: async ({ request, decorateResponse }) => {
    const { userId, client } = await openAccountSession({
      request,
      decorateResponse,
    });
    const reader = createSupabaseNotificationReader(client);
    return { data: { unreadCount: await reader.countUnread(userId) } };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getUnreadCount,
});
