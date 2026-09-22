"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BellIcon } from "@/components/NavIcons";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator, type Translator } from "@/lib/i18n/translator";
import {
  type NotificationListState,
  NotificationPanel,
  type MarkReadFailure,
} from "./NotificationPanel";
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notifications-client";

/**
 * La campana de la cabecera (#266, RF-4 del PRD de E6): el número de avisos
 * sin leer y la lista que abre. Es de cliente porque pregunta por el número
 * cada minuto y abre y cierra su panel.
 *
 * Sin tiempo real a propósito (fuera de alcance del PRD): el número se pide
 * al montar, al cambiar de pantalla y cada minuto.
 */

const REFRESH_INTERVAL_MS = 60_000;
/** Más de esto se escribe "9+", como en el prototipo: el círculo no da para
 * dos cifras. El lector de pantalla sí dice el número exacto. */
const MAX_BADGE_COUNT = 9;

function badgeText(unreadCount: number | null): string | null {
  if (unreadCount === null || unreadCount === 0) {
    return null;
  }
  return unreadCount > MAX_BADGE_COUNT
    ? `${MAX_BADGE_COUNT}+`
    : String(unreadCount);
}

function bellLabel(translate: Translator, unreadCount: number | null): string {
  if (unreadCount === null) {
    return translate("notifications.panel.title");
  }
  return unreadCount === 0
    ? translate("notifications.bell.labelNoneUnread")
    : translate("notifications.bell.label", { count: unreadCount });
}

/** El número de la campana, al día al montar, al navegar y cada minuto. */
function useUnreadCount(): readonly [
  number | null,
  (update: (current: number | null) => number | null) => void,
] {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function refresh(): Promise<void> {
      const result = await fetchUnreadCount();
      // Si no se pudo contar se queda el último número: la cabecera no es
      // sitio para un error, y la próxima vuelta lo vuelve a intentar.
      if (isMounted && result.kind === "ok") {
        setUnreadCount(result.unreadCount);
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [pathname]);

  return [unreadCount, setUnreadCount] as const;
}

/** Cerrar con Escape o pulsando fuera, mientras está abierto. */
function useDismissal(options: {
  readonly isOpen: boolean;
  readonly containerRef: React.RefObject<HTMLDivElement | null>;
  readonly onEscape: () => void;
  readonly onOutsideClick: () => void;
}): void {
  const { isOpen, containerRef, onEscape, onOutsideClick } = options;
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onEscape();
      }
    }
    function handlePointerDown(event: PointerEvent): void {
      const container = containerRef.current;
      if (container !== null && !container.contains(event.target as Node)) {
        onOutsideClick();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen, containerRef, onEscape, onOutsideClick]);
}

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

export function NotificationBell({
  locale,
}: {
  locale: Locale;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [unreadCount, setUnreadCount] = useUnreadCount();
  const [isOpen, setIsOpen] = useState(false);
  const [list, setList] = useState<NotificationListState>({
    status: "loading",
  });
  const [markFailure, setMarkFailure] = useState<MarkReadFailure | null>(null);

  const close = useCallback(() => {
    setIsOpen(false);
    setMarkFailure(null);
  }, []);
  const closeAndReturnFocus = useCallback(() => {
    close();
    bellRef.current?.focus();
  }, [close]);
  useDismissal({
    isOpen,
    containerRef,
    onEscape: closeAndReturnFocus,
    onOutsideClick: close,
  });

  useEffect(() => {
    if (isOpen) {
      headingRef.current?.focus();
    }
  }, [isOpen]);

  async function loadList(): Promise<void> {
    setList({ status: "loading" });
    const result = await fetchNotifications();
    setList(
      result.kind === "ok"
        ? { status: "loaded", notifications: result.notifications }
        : { status: "failed" },
    );
  }

  function toggle(): void {
    if (isOpen) {
      close();
      return;
    }
    setIsOpen(true);
    void loadList();
  }

  async function markAll(): Promise<void> {
    const result = await markAllNotificationsRead();
    if (result.kind === "failed") {
      setMarkFailure({ target: "all" });
      return;
    }
    setMarkFailure(null);
    setUnreadCount(() => 0);
    setList((current) => markAsRead(current, () => true));
  }

  async function markOne(notificationId: string): Promise<void> {
    const result = await markNotificationRead(notificationId);
    if (result.kind === "failed") {
      setMarkFailure({ target: "one", notificationId });
      return;
    }
    setMarkFailure(null);
    setUnreadCount((current) =>
      current === null ? null : Math.max(0, current - 1),
    );
    setList((current) => markAsRead(current, (id) => id === notificationId));
  }

  function retryMark(): void {
    if (markFailure === null) {
      return;
    }
    void (markFailure.target === "all"
      ? markAll()
      : markOne(markFailure.notificationId));
  }

  const badge = badgeText(unreadCount);
  const label = bellLabel(translate, unreadCount);
  return (
    <div className="notification-bell" ref={containerRef}>
      <button
        ref={bellRef}
        type="button"
        className="app-header-icon notification-bell-button"
        aria-label={label}
        title={label}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={toggle}
      >
        <BellIcon />
        {badge === null ? null : (
          <span className="notification-badge" aria-hidden="true">
            {badge}
          </span>
        )}
      </button>
      {isOpen ? (
        <NotificationPanel
          id={panelId}
          translate={translate}
          list={list}
          markFailure={markFailure}
          headingRef={headingRef}
          onBack={closeAndReturnFocus}
          onRetryLoad={() => void loadList()}
          onMarkAll={() => void markAll()}
          onMarkOne={(notificationId) => void markOne(notificationId)}
          onRetryMark={retryMark}
        />
      ) : null}
    </div>
  );
}
