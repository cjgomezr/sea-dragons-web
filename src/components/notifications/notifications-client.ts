import { z } from "zod";
import {
  type ApiRequestFailure,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { NOTIFICATIONS_API_PATH } from "@/lib/auth/routes";

/**
 * La campana habla con la API de avisos de #265 (CON-002): contar los sin
 * leer, traer la lista y marcarlos. Siempre los de quien tiene la sesión.
 */

const UNREAD_COUNT_API_PATH = `${NOTIFICATIONS_API_PATH}/unread-count`;
const READ_ALL_API_PATH = `${NOTIFICATIONS_API_PATH}/read-all`;
const READ_ONE_API_PATH = `${NOTIFICATIONS_API_PATH}/[id]/read`;

/** El tipo va como texto y los datos sin estrechar: un aviso que la pantalla
 * no sabe contar tiene que llegar igual, para salir con el texto genérico en
 * vez de tumbar la lista entera. */
const notificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime({ offset: true }),
  isRead: z.boolean(),
});

export type ListedNotification = z.infer<typeof notificationSchema>;

const unreadCountSchema = z.object({
  data: z.object({ unreadCount: z.number().int().nonnegative() }),
});

const notificationsSchema = z.object({
  data: z.object({ notifications: z.array(notificationSchema) }),
});

export type UnreadCountResult =
  { readonly kind: "ok"; readonly unreadCount: number } | ApiRequestFailure;

export type NotificationsResult =
  | {
      readonly kind: "ok";
      readonly notifications: readonly ListedNotification[];
    }
  | ApiRequestFailure;

export type MarkReadResult = { readonly kind: "marked" } | ApiRequestFailure;

export async function fetchUnreadCount(): Promise<UnreadCountResult> {
  const read = readApiPayload(
    await requestApi(UNREAD_COUNT_API_PATH),
    unreadCountSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "ok", unreadCount: read.value.data.unreadCount };
}

export async function fetchNotifications(): Promise<NotificationsResult> {
  const read = readApiPayload(
    await requestApi(NOTIFICATIONS_API_PATH),
    notificationsSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "ok", notifications: newestFirst(read.value.data.notifications) };
}

/** La API ya los manda así (FR-073); la pantalla no depende de ello para
 * cumplir su orden. */
function newestFirst(
  notifications: readonly ListedNotification[],
): readonly ListedNotification[] {
  return [...notifications].sort(
    (first, second) =>
      Date.parse(second.createdAt) - Date.parse(first.createdAt),
  );
}

async function postWithoutBody(path: string): Promise<MarkReadResult> {
  const outcome = await requestApi(path, { method: "POST" });
  return outcome.kind === "failed" ? outcome : { kind: "marked" };
}

export function markNotificationRead(
  notificationId: string,
): Promise<MarkReadResult> {
  return postWithoutBody(
    READ_ONE_API_PATH.replace("[id]", encodeURIComponent(notificationId)),
  );
}

export function markAllNotificationsRead(): Promise<MarkReadResult> {
  return postWithoutBody(READ_ALL_API_PATH);
}
