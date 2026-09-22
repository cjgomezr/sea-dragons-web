import type { Ref } from "react";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { describeNotification } from "@/lib/notifications/notification-text";
import type { ListedNotification } from "./notifications-client";

/**
 * La lista que abre la campana (#266, RF-3 y RF-5 del PRD de E6). Es la misma
 * en los dos tamaños: en escritorio la hoja de estilos la dibuja como un
 * desplegable bajo la campana, y en el móvil como una pantalla entera con su
 * botón de volver, como en el prototipo.
 */

export type NotificationListState =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | {
      readonly status: "loaded";
      readonly notifications: readonly ListedNotification[];
    };

/** Qué no se pudo marcar, para que reintentar repita justo eso. */
export type MarkReadFailure =
  | { readonly target: "all" }
  | { readonly target: "one"; readonly notificationId: string };

export type NotificationPanelProps = {
  readonly id: string;
  readonly translate: Translator;
  readonly list: NotificationListState;
  readonly markFailure: MarkReadFailure | null;
  readonly headingRef: Ref<HTMLHeadingElement>;
  readonly onBack: () => void;
  readonly onRetryLoad: () => void;
  readonly onMarkAll: () => void;
  readonly onMarkOne: (notificationId: string) => void;
  readonly onRetryMark: () => void;
};

function hasUnread(list: NotificationListState): boolean {
  return (
    list.status === "loaded" &&
    list.notifications.some((notification) => !notification.isRead)
  );
}

function NotificationContent({
  translate,
  notification,
  now,
}: {
  readonly translate: Translator;
  readonly notification: ListedNotification;
  readonly now: Date;
}): React.JSX.Element {
  const { title, body } = describeNotification(translate, notification);
  return (
    <>
      <span className="notification-text">
        <span className="notification-title">{title}</span>
        <span className="notification-body">{body}</span>
        <time className="notification-time" dateTime={notification.createdAt}>
          {formatRelativeTime(
            translate.locale,
            new Date(notification.createdAt),
            now,
          )}
        </time>
      </span>
      {notification.isRead ? null : (
        <span className="notification-unread-dot">
          <span className="visually-hidden">
            {translate("notifications.panel.unread")}
          </span>
        </span>
      )}
    </>
  );
}

function NotificationItems({
  translate,
  notifications,
  onMarkOne,
}: {
  readonly translate: Translator;
  readonly notifications: readonly ListedNotification[];
  readonly onMarkOne: (notificationId: string) => void;
}): React.JSX.Element {
  if (notifications.length === 0) {
    return (
      <p className="notification-panel-message">
        {translate("notifications.panel.empty")}
      </p>
    );
  }
  const now = new Date();
  return (
    <ul className="notification-list">
      {notifications.map((notification) => (
        <li
          key={notification.id}
          className={
            notification.isRead
              ? "notification-item"
              : "notification-item notification-item-unread"
          }
        >
          {/* Sólo se abre el que está sin leer: abrirlo, por ahora, no hace
              más que marcarlo (fuera de alcance de #266 llevar a su pantalla). */}
          {notification.isRead ? (
            <div className="notification-item-content">
              <NotificationContent
                translate={translate}
                notification={notification}
                now={now}
              />
            </div>
          ) : (
            <button
              type="button"
              className="notification-item-content"
              onClick={() => onMarkOne(notification.id)}
            >
              <NotificationContent
                translate={translate}
                notification={notification}
                now={now}
              />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function ListBody({
  translate,
  list,
  onRetryLoad,
  onMarkOne,
}: Pick<
  NotificationPanelProps,
  "translate" | "list" | "onRetryLoad" | "onMarkOne"
>): React.JSX.Element {
  switch (list.status) {
    case "loading":
      return (
        <p className="notification-panel-message" role="status">
          {translate("notifications.panel.loading")}
        </p>
      );
    case "failed":
      return (
        <div className="notification-panel-message" role="alert">
          <p>{translate("notifications.panel.error.load")}</p>
          <button
            type="button"
            className="auth-secondary"
            onClick={onRetryLoad}
          >
            {translate("notifications.panel.retry")}
          </button>
        </div>
      );
    case "loaded":
      return (
        <NotificationItems
          translate={translate}
          notifications={list.notifications}
          onMarkOne={onMarkOne}
        />
      );
  }
}

export function NotificationPanel(
  props: NotificationPanelProps,
): React.JSX.Element {
  const { id, translate, list, markFailure, headingRef } = props;
  const headingId = `${id}-titulo`;
  return (
    <section id={id} className="notification-panel" aria-labelledby={headingId}>
      <div className="notification-panel-header">
        <button
          type="button"
          className="notification-panel-back"
          onClick={props.onBack}
        >
          <span aria-hidden="true">←</span>
          <span className="visually-hidden">
            {translate("notifications.panel.back")}
          </span>
        </button>
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {translate("notifications.panel.title")}
        </h2>
        {hasUnread(list) ? (
          <button
            type="button"
            className="notification-mark-all"
            onClick={props.onMarkAll}
          >
            {translate("notifications.panel.markAllRead")}
          </button>
        ) : null}
      </div>
      {markFailure === null ? null : (
        <div className="notification-panel-alert" role="alert">
          <p>{translate("notifications.panel.error.markRead")}</p>
          <button
            type="button"
            className="auth-secondary"
            onClick={props.onRetryMark}
          >
            {translate("notifications.panel.retry")}
          </button>
        </div>
      )}
      <ListBody
        translate={translate}
        list={list}
        onRetryLoad={props.onRetryLoad}
        onMarkOne={props.onMarkOne}
      />
    </section>
  );
}
