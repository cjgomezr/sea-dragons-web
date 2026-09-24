import { z } from "zod";
import { REQUESTABLE_ROLES } from "@/lib/auth/role-request";
import { ACCOUNT_PAGE_PATH, DIRECTORY_PATH } from "@/lib/auth/routes";
import { ROLES } from "@/lib/auth/roles";
import type { Translator } from "@/lib/i18n/translator";
import type { NotificationType } from "./notify-member";

/**
 * El texto de un aviso, armado al pintarlo con su tipo y sus datos (#266, RF-3
 * del PRD de E6). La base no guarda frases: así un aviso sale en el idioma de
 * la pantalla aunque se creara con la aplicación en el otro.
 *
 * Un tipo que esta pantalla no conoce, o unos datos que no encajan con su
 * tipo, dan un texto genérico en vez de romper la lista. Pasa con un aviso
 * viejo cuyos datos cambiaron de forma, o con uno nuevo que llega antes que la
 * versión de la pantalla que sabe contarlo.
 */

/** Un aviso tal como llega de la API, sin estrechar todavía. */
export type NotificationToDescribe = {
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
};

export type NotificationText = {
  readonly title: string;
  readonly body: string;
};

type DescribeKnownType = (
  translate: Translator,
  data: Readonly<Record<string, unknown>>,
) => NotificationText | null;

const roleChangedData = z.object({ newRole: z.enum(ROLES) });
const roleRequestRejectedData = z.object({
  requestedRole: z.enum(REQUESTABLE_ROLES),
});
const roleRequestReceivedData = z.object({
  requesterName: z.string().min(1),
  requestedRole: z.enum(REQUESTABLE_ROLES),
});

/** Un `Record` sobre el catálogo: un tipo nuevo no compila hasta tener texto. */
const DESCRIBE_BY_TYPE: Readonly<Record<NotificationType, DescribeKnownType>> =
  {
    role_changed: (translate, data) => {
      const parsed = roleChangedData.safeParse(data);
      if (!parsed.success) {
        return null;
      }
      return {
        title: translate("notifications.role_changed.title"),
        body: translate("notifications.role_changed.body", {
          role: translate(`role.${parsed.data.newRole}`),
        }),
      };
    },
    role_request_rejected: (translate, data) => {
      const parsed = roleRequestRejectedData.safeParse(data);
      if (!parsed.success) {
        return null;
      }
      return {
        title: translate("notifications.role_request_rejected.title"),
        body: translate("notifications.role_request_rejected.body", {
          role: translate(`role.${parsed.data.requestedRole}`),
        }),
      };
    },
    role_request_received: (translate, data) => {
      const parsed = roleRequestReceivedData.safeParse(data);
      if (!parsed.success) {
        return null;
      }
      return {
        title: translate("notifications.role_request_received.title"),
        body: translate("notifications.role_request_received.body", {
          name: parsed.data.requesterName,
          role: translate(`role.${parsed.data.requestedRole}`),
        }),
      };
    },
  };

function isKnownType(type: string): type is NotificationType {
  return Object.hasOwn(DESCRIBE_BY_TYPE, type);
}

/** La pantalla donde se actúa sobre cada tipo (#338). Un `Record` sobre el
 * catálogo, como los textos: un tipo nuevo no compila sin decir a dónde lleva. */
const DESTINATION_BY_TYPE: Readonly<Record<NotificationType, string>> = {
  role_changed: ACCOUNT_PAGE_PATH,
  role_request_rejected: ACCOUNT_PAGE_PATH,
  // La bandeja de solicitudes, para aprobarla o rechazarla, está en el
  // directorio.
  role_request_received: DIRECTORY_PATH,
};

/** `null` para un tipo que esta pantalla no reconoce: se marca, no se sigue. */
export function notificationDestination(type: string): string | null {
  return isKnownType(type) ? DESTINATION_BY_TYPE[type] : null;
}

export function describeNotification(
  translate: Translator,
  notification: NotificationToDescribe,
): NotificationText {
  const described = isKnownType(notification.type)
    ? DESCRIBE_BY_TYPE[notification.type](translate, notification.data)
    : null;
  return (
    described ?? {
      title: translate("notifications.generic.title"),
      body: translate("notifications.generic.body"),
    }
  );
}
