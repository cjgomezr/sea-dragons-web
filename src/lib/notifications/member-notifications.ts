import type { NotificationType } from "./notify-member";

/**
 * Los avisos de un socio, tal como los leen la campana y su lista (#265, RF-3
 * a RF-5 del PRD de E6). Siempre los de quien llama: los adaptadores filtran
 * por su id además de por la RLS.
 */

/** La lista trae los más recientes; los anteriores siguen guardados (FR-073).
 * No hay paginación más allá. */
export const RECENT_NOTIFICATIONS_LIMIT = 50;

/** Un aviso como sale de la base. Los datos van sin estrechar a propósito: un
 * aviso viejo cuyos datos ya no encajan con su tipo tiene que llegar igual a
 * la pantalla, que muestra un texto genérico en vez de romper la lista. */
export type MemberNotification = {
  readonly id: string;
  readonly type: NotificationType;
  readonly data: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly isRead: boolean;
};

export type NotificationReader = {
  /** De más nuevo a más viejo. */
  listRecent(
    userId: string,
    limit: number,
  ): Promise<readonly MemberNotification[]>;
  countUnread(userId: string): Promise<number>;
};

/** `already_read` deja la fecha de lectura como estaba. `not_found` cubre
 * también el aviso de otro socio: para quien llama, no existe. */
export type MarkReadOutcome = "marked" | "already_read" | "not_found";

export type NotificationMarker = {
  markRead(target: {
    readonly userId: string;
    readonly notificationId: string;
  }): Promise<MarkReadOutcome>;
  markAllRead(userId: string): Promise<void>;
};
