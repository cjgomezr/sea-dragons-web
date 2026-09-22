"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BellIcon } from "@/components/NavIcons";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator, type Translator } from "@/lib/i18n/translator";
import { NotificationPanel } from "./NotificationPanel";
import { fetchUnreadCount } from "./notifications-client";
import {
  type UnreadChange,
  useNotificationList,
} from "./use-notification-list";

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

/** El número tras marcar: todos leídos lo deja en cero, uno lo baja en uno. */
function countAfter(
  change: UnreadChange,
  current: number | null,
): number | null {
  if (change === "all_read") {
    return 0;
  }
  return current === null ? null : Math.max(0, current - 1);
}

/** Cerrar con Escape, pulsando fuera o cuando el foco sale del panel. Lo
 * último importa en el móvil: la lista tapa la pantalla, y el foco no puede
 * seguir por lo que hay debajo, que no se ve. */
function useDismissal(options: {
  readonly isOpen: boolean;
  readonly containerRef: React.RefObject<HTMLDivElement | null>;
  readonly onEscape: () => void;
  readonly onLeave: () => void;
}): void {
  const { isOpen, containerRef, onEscape, onLeave } = options;
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function isOutside(target: EventTarget | null): boolean {
      const container = containerRef.current;
      return (
        container !== null &&
        target instanceof Node &&
        !container.contains(target)
      );
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onEscape();
      }
    }
    function handleLeave(event: Event): void {
      if (isOutside(event.target)) {
        onLeave();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handleLeave);
    document.addEventListener("focusin", handleLeave);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handleLeave);
      document.removeEventListener("focusin", handleLeave);
    };
  }, [isOpen, containerRef, onEscape, onLeave]);
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
  const notifications = useNotificationList((change) =>
    setUnreadCount((current) => countAfter(change, current)),
  );
  const { clearMarkFailure } = notifications;

  const close = useCallback(() => {
    setIsOpen(false);
    clearMarkFailure();
  }, [clearMarkFailure]);
  const closeAndReturnFocus = useCallback(() => {
    close();
    bellRef.current?.focus();
  }, [close]);
  useDismissal({
    isOpen,
    containerRef,
    onEscape: closeAndReturnFocus,
    onLeave: close,
  });

  useEffect(() => {
    if (isOpen) {
      headingRef.current?.focus();
    }
  }, [isOpen]);

  function toggle(): void {
    if (isOpen) {
      close();
      return;
    }
    setIsOpen(true);
    void notifications.loadList();
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
          list={notifications.list}
          markFailure={notifications.markFailure}
          headingRef={headingRef}
          onBack={closeAndReturnFocus}
          onRetryLoad={() => void notifications.loadList()}
          onMarkAll={() => void notifications.markAll()}
          onMarkOne={(notificationId) =>
            void notifications.markOne(notificationId)
          }
          onRetryMark={notifications.retryMark}
        />
      ) : null}
    </div>
  );
}
