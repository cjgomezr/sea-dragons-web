import { z } from "zod";
import { REQUESTABLE_ROLES } from "@/lib/auth/role-request";
import {
  ACCOUNT_PAGE_PATH,
  CALENDAR_PATH,
  DIRECTORY_PATH,
  NEWS_POST_PATH,
} from "@/lib/auth/routes";
import { ROLES } from "@/lib/auth/roles";
import { EVENT_TYPES } from "@/lib/events/event-creation";
import { ISO_WEEKDAYS } from "@/lib/events/event-occurrences";
import {
  formatCalendarDay,
  formatCalendarDayAt,
  formatClockTime,
  formatWeekdays,
} from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { NEWS_CATEGORIES } from "@/lib/news/news-posts";
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

const newsPostPublishedData = z.object({
  postId: z.uuid(),
  category: z.enum(NEWS_CATEGORIES),
  title: z.string().min(1),
});

/** `HH:MM`, sin segundos, como la guarda un evento. */
const clockTime = z.iso.time({ precision: -1 });

const seriesWeekdays = z
  .array(z.union(ISO_WEEKDAYS.map((day) => z.literal(day))))
  .min(1);

const eventCreatedData = z.object({
  eventId: z.uuid(),
  title: z.string().min(1),
  eventType: z.enum(EVENT_TYPES),
  startsOn: z.iso.date(),
  startTime: clockTime,
});

const eventSeriesCreatedData = z.object({
  seriesId: z.uuid(),
  title: z.string().min(1),
  eventType: z.enum(EVENT_TYPES),
  weekdays: seriesWeekdays,
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  startTime: clockTime,
});

const eventChangedData = z.object({
  eventId: z.uuid(),
  title: z.string().min(1),
  startsOn: z.iso.date(),
  startTime: clockTime,
  location: z.string().min(1),
});

const eventCancelledData = z.object({
  eventId: z.uuid(),
  title: z.string().min(1),
  startsOn: z.iso.date(),
  startTime: clockTime,
});

const eventSeriesChangedData = z.object({
  seriesId: z.uuid(),
  title: z.string().min(1),
  weekdays: seriesWeekdays,
  startTime: clockTime,
  location: z.string().min(1),
});

const eventSeriesCancelledData = z.object({
  seriesId: z.uuid(),
  title: z.string().min(1),
  weekdays: seriesWeekdays,
  startTime: clockTime,
});

const teamUnassignedData = z.object({
  eventId: z.uuid(),
  title: z.string().min(1),
  startsOn: z.iso.date(),
  startTime: clockTime,
});

const teamAssignedData = teamUnassignedData.extend({
  teamName: z.string().min(1),
  teamColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
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
    news_post_published: (translate, data) => {
      const parsed = newsPostPublishedData.safeParse(data);
      if (!parsed.success) {
        return null;
      }
      return {
        title: translate("notifications.news_post_published.title", {
          category: translate(`news.category.${parsed.data.category}`),
        }),
        body: parsed.data.title,
      };
    },
    event_created: (translate, data) => {
      const parsed = eventCreatedData.safeParse(data);
      if (!parsed.success) {
        return null;
      }
      const event = parsed.data;
      return {
        title: translate("notifications.event_created.title", {
          eventType: translate(`event.type.${event.eventType}`),
        }),
        body: translate("notifications.event_created.body", {
          title: event.title,
          moment: formatCalendarDayAt(
            translate.locale,
            event.startsOn,
            event.startTime,
          ),
        }),
      };
    },
    event_series_created: (translate, data) => {
      const parsed = eventSeriesCreatedData.safeParse(data);
      if (!parsed.success) {
        return null;
      }
      const series = parsed.data;
      const { locale } = translate;
      return {
        title: translate("notifications.event_series_created.title", {
          eventType: translate(`event.type.${series.eventType}`),
        }),
        body: translate("notifications.event_series_created.body", {
          title: series.title,
          weekdays: formatWeekdays(locale, series.weekdays),
          time: formatClockTime(locale, series.startTime),
          startsOn: formatCalendarDay(locale, series.startsOn),
          endsOn: formatCalendarDay(locale, series.endsOn),
        }),
      };
    },
    event_changed: (translate, data) => {
      const parsed = eventChangedData.safeParse(data);
      if (!parsed.success) {
        return null;
      }
      const event = parsed.data;
      return {
        title: translate("notifications.event_changed.title"),
        body: translate("notifications.event_changed.body", {
          title: event.title,
          moment: formatCalendarDayAt(
            translate.locale,
            event.startsOn,
            event.startTime,
          ),
          location: event.location,
        }),
      };
    },
    event_cancelled: (translate, data) => {
      const parsed = eventCancelledData.safeParse(data);
      if (!parsed.success) {
        return null;
      }
      const event = parsed.data;
      return {
        title: translate("notifications.event_cancelled.title"),
        body: translate("notifications.event_cancelled.body", {
          title: event.title,
          moment: formatCalendarDayAt(
            translate.locale,
            event.startsOn,
            event.startTime,
          ),
        }),
      };
    },
    event_series_changed: (translate, data) => {
      const parsed = eventSeriesChangedData.safeParse(data);
      if (!parsed.success) {
        return null;
      }
      const series = parsed.data;
      const { locale } = translate;
      return {
        title: translate("notifications.event_series_changed.title"),
        body: translate("notifications.event_series_changed.body", {
          title: series.title,
          weekdays: formatWeekdays(locale, series.weekdays),
          time: formatClockTime(locale, series.startTime),
          location: series.location,
        }),
      };
    },
    event_series_cancelled: (translate, data) => {
      const parsed = eventSeriesCancelledData.safeParse(data);
      if (!parsed.success) {
        return null;
      }
      const series = parsed.data;
      const { locale } = translate;
      return {
        title: translate("notifications.event_series_cancelled.title"),
        body: translate("notifications.event_series_cancelled.body", {
          title: series.title,
          weekdays: formatWeekdays(locale, series.weekdays),
          time: formatClockTime(locale, series.startTime),
        }),
      };
    },
    team_assigned: (translate, data) => {
      const parsed = teamAssignedData.safeParse(data);
      if (!parsed.success) {
        return null;
      }
      const assignment = parsed.data;
      return {
        title: translate("notifications.team_assigned.title", {
          team: assignment.teamName,
        }),
        body: translate("notifications.team_assigned.body", {
          title: assignment.title,
          moment: formatCalendarDayAt(
            translate.locale,
            assignment.startsOn,
            assignment.startTime,
          ),
        }),
      };
    },
    team_unassigned: (translate, data) => {
      const parsed = teamUnassignedData.safeParse(data);
      if (!parsed.success) {
        return null;
      }
      const event = parsed.data;
      return {
        title: translate("notifications.team_unassigned.title"),
        body: translate("notifications.team_unassigned.body", {
          title: event.title,
          moment: formatCalendarDayAt(
            translate.locale,
            event.startsOn,
            event.startTime,
          ),
        }),
      };
    },
  };

function isKnownType(type: string): type is NotificationType {
  return Object.hasOwn(DESCRIBE_BY_TYPE, type);
}

/** La pantalla donde se actúa sobre cada tipo (#338), o `null` si sus datos
 * no dicen a dónde. Un `Record` sobre el catálogo, como los textos: un tipo
 * nuevo no compila sin decir a dónde lleva. */
type DestinationOf = (data: Readonly<Record<string, unknown>>) => string | null;

const DESTINATION_BY_TYPE: Readonly<Record<NotificationType, DestinationOf>> = {
  role_changed: () => ACCOUNT_PAGE_PATH,
  role_request_rejected: () => ACCOUNT_PAGE_PATH,
  // La bandeja de solicitudes, para aprobarla o rechazarla, está en el
  // directorio.
  role_request_received: () => DIRECTORY_PATH,
  // #332: la publicación misma.
  news_post_published: (data) => {
    const parsed = newsPostPublishedData.safeParse(data);
    return parsed.success
      ? NEWS_POST_PATH.replace("[id]", parsed.data.postId)
      : null;
  },
  // #310: al calendario. Llevar al evento mismo queda para cuando tenga
  // pantalla propia.
  event_created: (data) =>
    eventCreatedData.safeParse(data).success ? CALENDAR_PATH : null,
  event_series_created: (data) =>
    eventSeriesCreatedData.safeParse(data).success ? CALENDAR_PATH : null,
  // #317: al calendario, donde se ve lo que quedó.
  event_changed: (data) =>
    eventChangedData.safeParse(data).success ? CALENDAR_PATH : null,
  event_cancelled: (data) =>
    eventCancelledData.safeParse(data).success ? CALENDAR_PATH : null,
  event_series_changed: (data) =>
    eventSeriesChangedData.safeParse(data).success ? CALENDAR_PATH : null,
  event_series_cancelled: (data) =>
    eventSeriesCancelledData.safeParse(data).success ? CALENDAR_PATH : null,
  // #401: al calendario, donde el evento enseña el equipo (#403).
  team_assigned: (data) =>
    teamAssignedData.safeParse(data).success ? CALENDAR_PATH : null,
  team_unassigned: (data) =>
    teamUnassignedData.safeParse(data).success ? CALENDAR_PATH : null,
};

/** `null` para un tipo que esta pantalla no reconoce, o para unos datos que
 * no dicen a dónde llevar: se marca, no se sigue. */
export function notificationDestination(
  notification: NotificationToDescribe,
): string | null {
  return isKnownType(notification.type)
    ? DESTINATION_BY_TYPE[notification.type](notification.data)
    : null;
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
