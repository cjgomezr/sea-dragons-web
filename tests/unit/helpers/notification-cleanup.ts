import type { NotificationWriter } from "@/lib/notifications/notify-member";

/**
 * La limpieza de avisos (#339) para los tests que no la miran: no borra nada
 * y no deja nada para después. Los que avisan (cambio de rol, solicitudes)
 * sólo necesitan que su `NotificationWriter` la tenga.
 */
export const NO_NOTIFICATION_CLEANUP: Pick<
  NotificationWriter,
  "pruneNotifications" | "runAfterResponse"
> = {
  pruneNotifications: async () => ({ deletedCount: 0, keptCount: 0 }),
  runAfterResponse: () => {},
};
