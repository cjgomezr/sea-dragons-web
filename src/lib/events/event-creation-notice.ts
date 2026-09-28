import type { AudienceMembersGateway } from "@/lib/notifications/audience-members";
import {
  type NotificationBroadcastWriter,
  type NotificationContent,
  notifyMembers,
} from "@/lib/notifications/notify-member";
import type { CreatedEvents, EventAudience } from "./event-creation";

/**
 * El aviso a la audiencia cuando se crea un evento o una serie (#310, RF-10
 * del PRD de E7, FR-037, AC-013). Va por la puerta única de avisos, que ya
 * sabe no avisar a una cuenta dada de baja ni dos veces a la misma persona, y
 * escribe todos los avisos de una vez.
 *
 * Una serie se avisa una sola vez, con sus días y su rango: una temporada son
 * decenas de ocurrencias. Y el aviso nunca tumba la creación, que ya está
 * guardada cuando se llega aquí: un fallo se registra y nada más.
 */

export type EventNoticeGateways = {
  readonly eventAudience: AudienceMembersGateway;
  readonly notifications: NotificationBroadcastWriter;
};

export type EventAnnouncement = {
  readonly clubId: string;
  readonly authorId: string;
  readonly created: CreatedEvents;
};

/** Los datos mínimos para contarlo: nada de lugar ni notas. */
function noticeOf(created: CreatedEvents): NotificationContent {
  if (created.repeat === "none") {
    const { event } = created;
    return {
      type: "event_created",
      data: {
        eventId: event.id,
        title: event.title,
        eventType: event.eventType,
        startsOn: event.startsOn,
        startTime: event.startTime,
      },
    };
  }
  const { series } = created;
  return {
    type: "event_series_created",
    data: {
      seriesId: series.id,
      title: series.title,
      eventType: series.eventType,
      weekdays: series.weekdays,
      startsOn: series.startsOn,
      endsOn: series.endsOn,
      startTime: series.startTime,
    },
  };
}

function audienceOf(created: CreatedEvents): EventAudience {
  return created.repeat === "none"
    ? created.event.audience
    : created.series.audience;
}

/** Un aviso para la audiencia de un evento o una serie, sin quien lo
 * provocó. No lanza: si no se puede leer la audiencia o guardar los avisos,
 * lo registra y sigue, porque el cambio que lo originó ya está guardado.
 * También lo usan editar y cancelar (#317). */
export async function notifyEventAudience(
  gateways: EventNoticeGateways,
  notice: {
    readonly clubId: string;
    readonly authorId: string;
    readonly audience: EventAudience;
    readonly content: NotificationContent;
  },
): Promise<void> {
  const { clubId, authorId, audience, content } = notice;
  let audienceIds: readonly string[];
  try {
    audienceIds = await gateways.eventAudience.findAudienceMemberIds({
      clubId,
      audience,
    });
  } catch (error) {
    console.error(
      `[events] no se pudo leer la audiencia en el club ${clubId}; nadie recibe el aviso ${content.type}`,
      error,
    );
    return;
  }
  // `notifyMembers` no lanza: un aviso perdido queda registrado allí.
  await notifyMembers(gateways.notifications, {
    ...content,
    recipientUserIds: audienceIds.filter((id) => id !== authorId),
  });
}

export async function announceEvents(
  gateways: EventNoticeGateways,
  announcement: EventAnnouncement,
): Promise<void> {
  const { created } = announcement;
  await notifyEventAudience(gateways, {
    ...announcement,
    audience: audienceOf(created),
    content: noticeOf(created),
  });
}
