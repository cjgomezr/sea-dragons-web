import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { openAccountSession } from "@/lib/auth/account-api";
import {
  type MemberNotification,
  RECENT_NOTIFICATIONS_LIMIT,
} from "@/lib/notifications/member-notifications";
import { createSupabaseNotificationReader } from "@/lib/notifications/supabase-notification-gateways";

/**
 * Los avisos de quien llama (#265, RF-3 del PRD de E6, FR-073): los 50 más
 * recientes, de más nuevo a más viejo. Lo alcanza cualquier cuenta activa: la
 * frontera ya respondió 401 o 403 a quien no tiene sesión o la tiene a medias.
 *
 * Lee con la sesión de quien llama, no con la llave de servicio: la RLS de
 * `0019_notifications.sql` ya limita esa lectura a sus propios avisos. El
 * texto de cada aviso lo arma la pantalla con su tipo y sus datos.
 */

// Depende de la sesión de quien llama y de sus avisos en este instante.
export const dynamic = "force-dynamic";

export type NotificationsResponse = {
  readonly notifications: readonly MemberNotification[];
};

const getNotifications = createApiRoute<NotificationsResponse>({
  handler: async ({ request, decorateResponse }) => {
    const { userId, client } = await openAccountSession({
      request,
      decorateResponse,
    });
    const reader = createSupabaseNotificationReader(client);
    return {
      data: {
        notifications: await reader.listRecent(
          userId,
          RECENT_NOTIFICATIONS_LIMIT,
        ),
      },
    };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getNotifications,
});
