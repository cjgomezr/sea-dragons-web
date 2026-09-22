import { useCallback, useRef, useState } from "react";
import type {
  MarkReadFailure,
  NotificationListState,
} from "./NotificationPanel";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notifications-client";

/**
 * La lista de la campana y lo que se hace con ella: cargarla, marcar uno o
 * todos y reintentar lo que falló. Cuando marcar sale bien, avisa del cambio
 * al número de la campana con `onUnreadChange`.
 */

export type UnreadChange = "all_read" | "one_read";

export type NotificationList = {
  readonly list: NotificationListState;
  readonly markFailure: MarkReadFailure | null;
  readonly loadList: () => Promise<void>;
  readonly markAll: () => Promise<void>;
  readonly markOne: (notificationId: string) => Promise<void>;
  readonly retryMark: () => void;
  readonly clearMarkFailure: () => void;
};

function markAsRead(
  list: NotificationListState,
  isTarget: (notificationId: string) => boolean,
): NotificationListState {
  if (list.status !== "loaded") {
    return list;
  }
  return {
    status: "loaded",
    notifications: list.notifications.map((notification) =>
      isTarget(notification.id)
        ? { ...notification, isRead: true }
        : notification,
    ),
  };
}

export function useNotificationList(
  onUnreadChange: (change: UnreadChange) => void,
): NotificationList {
  const [list, setList] = useState<NotificationListState>({
    status: "loading",
  });
  const [markFailure, setMarkFailure] = useState<MarkReadFailure | null>(null);
  // Abrir, cerrar y volver a abrir deprisa lanza dos lecturas: sólo cuenta la
  // última, aunque la primera conteste después.
  const latestLoad = useRef(0);
  // Un doble toque en el móvil no marca dos veces: el segundo llegaría con el
  // aviso ya leído y bajaría el número otra vez.
  const pendingIds = useRef(new Set<string>());

  async function loadList(): Promise<void> {
    latestLoad.current += 1;
    const thisLoad = latestLoad.current;
    setList({ status: "loading" });
    const result = await fetchNotifications();
    if (thisLoad !== latestLoad.current) {
      return;
    }
    setList(
      result.kind === "ok"
        ? { status: "loaded", notifications: result.notifications }
        : { status: "failed" },
    );
  }

  async function markAll(): Promise<void> {
    const result = await markAllNotificationsRead();
    if (result.kind === "failed") {
      setMarkFailure({ target: "all" });
      return;
    }
    setMarkFailure(null);
    onUnreadChange("all_read");
    setList((current) => markAsRead(current, () => true));
  }

  async function markOne(notificationId: string): Promise<void> {
    if (pendingIds.current.has(notificationId)) {
      return;
    }
    pendingIds.current.add(notificationId);
    const result = await markNotificationRead(notificationId);
    pendingIds.current.delete(notificationId);
    if (result.kind === "failed") {
      setMarkFailure({ target: "one", notificationId });
      return;
    }
    setMarkFailure(null);
    onUnreadChange("one_read");
    setList((current) => markAsRead(current, (id) => id === notificationId));
  }

  const clearMarkFailure = useCallback(() => setMarkFailure(null), []);

  function retryMark(): void {
    if (markFailure === null) {
      return;
    }
    void (markFailure.target === "all"
      ? markAll()
      : markOne(markFailure.notificationId));
  }

  return {
    list,
    markFailure,
    loadList,
    markAll,
    markOne,
    retryMark,
    clearMarkFailure,
  };
}
