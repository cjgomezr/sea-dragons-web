import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ACCOUNT_STATUSES } from "@/lib/auth/account-status";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  MemberNotification,
  NotificationMarker,
  NotificationReader,
} from "./member-notifications";
import { NOTIFICATION_TYPES, type NotificationWriter } from "./notify-member";

/**
 * Los avisos contra Supabase (#265).
 *
 * Leer va con el cliente de la sesión del socio: la RLS de
 * `0019_notifications.sql` ya lo limita a sus avisos. Crear y marcar van con
 * la llave de servicio, porque `authenticated` no tiene privilegio de
 * escritura sobre la tabla. Por eso todas las consultas filtran además por el
 * destinatario: sin ese filtro, con la llave de servicio saldrían los avisos
 * de todo el club.
 */

const NOTIFICATIONS_TABLE = "notifications";
const MEMBERS_TABLE = "members";
const NOTIFICATION_COLUMNS = "id, type, data, created_at, read_at";

type Environment = Readonly<Record<string, string | undefined>>;

const notificationRowSchema = z.object({
  id: z.string(),
  type: z.enum(NOTIFICATION_TYPES),
  data: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  read_at: z.string().nullable(),
});

const recipientRowSchema = z.object({
  club_id: z.string(),
  account_status: z.enum(ACCOUNT_STATUSES),
});

function toMemberNotification(row: unknown): MemberNotification {
  const parsed = notificationRowSchema.parse(row);
  return {
    id: parsed.id,
    type: parsed.type,
    data: parsed.data,
    createdAt: parsed.created_at,
    isRead: parsed.read_at !== null,
  };
}

export function createSupabaseNotificationReader(
  sessionClient: SupabaseClient,
): NotificationReader {
  return {
    async listRecent(userId, limit) {
      const { data, error } = await sessionClient
        .from(NOTIFICATIONS_TABLE)
        .select(NOTIFICATION_COLUMNS)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) {
        throw new Error(`No se pudieron leer los avisos: ${error.message}`);
      }
      return data.map(toMemberNotification);
    },
    async countUnread(userId) {
      // `head` no trae filas: sólo el conteo, que recorre el índice parcial de
      // los no leídos.
      const { count, error } = await sessionClient
        .from(NOTIFICATIONS_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("read_at", null);
      if (error) {
        throw new Error(
          `No se pudieron contar los avisos sin leer: ${error.message}`,
        );
      }
      if (count === null) {
        throw new Error("La base no devolvió el conteo de avisos sin leer.");
      }
      return count;
    },
  };
}

export function createSupabaseNotificationWriter(
  serviceClient: SupabaseClient,
): NotificationWriter {
  return {
    async findRecipient(userId) {
      const { data, error } = await serviceClient
        .from(MEMBERS_TABLE)
        .select("club_id, account_status")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        throw new Error(
          `No se pudo leer el destinatario del aviso: ${error.message}`,
        );
      }
      if (data === null) {
        return null;
      }
      const recipient = recipientRowSchema.parse(data);
      return {
        clubId: recipient.club_id,
        accountStatus: recipient.account_status,
      };
    },
    async insertNotification(row) {
      const { error } = await serviceClient.from(NOTIFICATIONS_TABLE).insert({
        club_id: row.clubId,
        user_id: row.userId,
        type: row.type,
        data: row.data,
      });
      if (error) {
        throw new Error(`No se pudo guardar el aviso: ${error.message}`);
      }
    },
  };
}

/** Marcar va con la llave de servicio. Va aparte de la raíz de composición
 * para que el test de integración la use con el cliente de servicio. */
export function createNotificationMarker(
  serviceClient: SupabaseClient,
): NotificationMarker {
  async function existsFor(
    userId: string,
    notificationId: string,
  ): Promise<boolean> {
    const { data, error } = await serviceClient
      .from(NOTIFICATIONS_TABLE)
      .select("id")
      .eq("id", notificationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      throw new Error(`No se pudo leer el aviso: ${error.message}`);
    }
    return data !== null;
  }

  return {
    async markRead({ userId, notificationId }) {
      // Sólo si sigue sin leer: marcarlo otra vez no mueve su fecha.
      const { data, error } = await serviceClient
        .from(NOTIFICATIONS_TABLE)
        .update({ read_at: new Date().toISOString() })
        .eq("id", notificationId)
        .eq("user_id", userId)
        .is("read_at", null)
        .select("id");
      if (error) {
        throw new Error(`No se pudo marcar el aviso: ${error.message}`);
      }
      if (data.length > 0) {
        return "marked";
      }
      return (await existsFor(userId, notificationId))
        ? "already_read"
        : "not_found";
    },
    async markAllRead(userId) {
      const { error } = await serviceClient
        .from(NOTIFICATIONS_TABLE)
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", userId)
        .is("read_at", null);
      if (error) {
        throw new Error(`No se pudieron marcar los avisos: ${error.message}`);
      }
    },
  };
}

export type NotificationMarkerWiring =
  | { readonly kind: "ready"; readonly marker: NotificationMarker }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición de los endpoints que marcan. Devuelve las variables
 * que faltan en vez de lanzar, para que la ruta responda 503 nombrándolas. */
export function createSupabaseNotificationMarker(
  env: Environment,
): NotificationMarkerWiring {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    marker: createNotificationMarker(createServiceRoleClient(env)),
  };
}
