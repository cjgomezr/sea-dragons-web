import type { Role } from "@/lib/auth/roles";
import type {
  EventRsvpGateways,
  NewEventRsvp,
  RsvpEvent,
} from "@/lib/events/event-rsvp";
import type { PublishedSeat } from "@/lib/events/team-player-notices";
import type {
  NotificationBroadcastWriter,
  NotificationInsert,
  NotificationType,
} from "@/lib/notifications/notify-member";

/**
 * Un club en memoria para los tests del RSVP (#308). El doble cumple el
 * contrato del adaptador: sólo encuentra eventos del club que se le pide, y
 * guardar dos veces la misma respuesta deja una sola, como el upsert sobre la
 * clave primaria.
 */

export const RSVP_CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
export const RSVP_CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
export const OTHER_CLUB_ID = "5c1ab000-0000-4000-8000-000000000002";
export const SENIOR_SQUAD_ID = "9a9a9a9a-0000-4000-8000-000000000009";
export const MASTERS_SQUAD_ID = "8b8b8b8b-0000-4000-8000-000000000008";
export const CLUB_EVENT_ID = "e1e1e1e1-0000-4000-8000-00000000000e";

/** 2027-06-15 10:00 en Melbourne (hora estándar, UTC+10). */
export const RSVP_NOW = new Date("2027-06-15T00:00:00Z");

/** Un entrenamiento para todo el club, el martes siguiente a las 19:00. */
export const UPCOMING_EVENT: RsvpEvent = {
  id: CLUB_EVENT_ID,
  clubId: RSVP_CLUB_ID,
  title: "Entrenamiento",
  status: "scheduled",
  startsAt: new Date("2027-06-22T09:00:00Z"),
  audience: { kind: "club" },
};

export type FakeRsvpClubOptions = {
  readonly callerRole?: Role;
  readonly callerIsMember?: false;
  readonly callerGroupIds?: readonly string[];
  readonly events?: readonly RsvpEvent[];
  /** El sitio de quien responde en el reparto publicado (#838); sin él, no
   * hay reparto publicado o no está en él. */
  readonly seat?: PublishedSeat;
  readonly activeAdminIds?: readonly string[];
  readonly isNotifyingFailing?: true;
  readonly isSeatLookupFailing?: true;
};

/** Un aviso guardado, con la hora de la respuesta que lo disparó. */
export type SentRsvpNotice = {
  readonly type: NotificationType;
  readonly data: Readonly<Record<string, unknown>>;
  readonly userId: string;
  readonly sentAt: Date;
};

export type FakeRsvpClub = {
  readonly gateways: EventRsvpGateways;
  /** Una fila por evento y miembro, como la clave primaria. */
  readonly saved: Map<string, NewEventRsvp>;
  readonly notices: SentRsvpNotice[];
  /** Vuelve a publicar el reparto a esa hora: cambia el sitio de quien
   * responde. */
  republish(at: Date): void;
};

/** Los avisos se fechan con la última respuesta guardada, que es la que los
 * dispara: así "desde la publicación" se puede contar sin reloj. */
function fakeNotifications(
  notices: SentRsvpNotice[],
  options: { readonly isFailing: boolean; readonly now: () => Date },
): NotificationBroadcastWriter {
  const record = (row: NotificationInsert): void => {
    if (options.isFailing) {
      throw new Error("La base de avisos no responde.");
    }
    notices.push({
      type: row.type,
      data: row.data,
      userId: row.userId,
      sentAt: options.now(),
    });
  };
  return {
    findRecipients: async (userIds) =>
      new Map(
        userIds.map((userId) => [
          userId,
          { clubId: RSVP_CLUB_ID, accountStatus: "active" as const },
        ]),
      ),
    insertNotifications: async (rows) => rows.forEach(record),
    insertNotification: async (row) => record(row),
    pruneNotificationsOf: async () => new Map(),
    runAfterResponse: () => undefined,
  };
}

export function fakeRsvpClub(options: FakeRsvpClubOptions = {}): FakeRsvpClub {
  const saved = new Map<string, NewEventRsvp>();
  const events = options.events ?? [UPCOMING_EVENT];
  const notices: SentRsvpNotice[] = [];
  let seat = options.seat ?? null;
  let lastRespondedAt = RSVP_NOW;
  const gateways: EventRsvpGateways = {
    members: {
      findRoleRequestMember: async () =>
        options.callerIsMember === false
          ? null
          : {
              clubId: RSVP_CLUB_ID,
              fullName: "Quien responde",
              role: options.callerRole ?? "Player",
            },
    },
    memberGroups: {
      listGroupsOf: async () =>
        (options.callerGroupIds ?? []).map((id) => ({ id, name: id })),
    },
    rsvps: {
      findEvent: async ({ clubId, eventId }) =>
        events.find(
          (event) => event.id === eventId && event.clubId === clubId,
        ) ?? null,
      findResponse: async ({ eventId, userId }) =>
        saved.get(`${eventId}|${userId}`)?.response ?? null,
      saveResponse: async (rsvp) => {
        saved.set(`${rsvp.eventId}|${rsvp.userId}`, rsvp);
        lastRespondedAt = rsvp.respondedAt;
      },
    },
    teamSeats: {
      findPublishedSeat: async () => {
        if (options.isSeatLookupFailing === true) {
          throw new Error("La base de repartos no responde.");
        }
        return seat;
      },
      hasPlayerNoticeSince: async ({ type, eventId, playerId, since }) =>
        notices.some(
          (notice) =>
            notice.type === type &&
            notice.data.eventId === eventId &&
            notice.data.playerId === playerId &&
            notice.sentAt.getTime() >= since.getTime(),
        ),
    },
    admins: {
      listActiveAdminUserIds: async () => options.activeAdminIds ?? [],
    },
    notifications: fakeNotifications(notices, {
      isFailing: options.isNotifyingFailing === true,
      now: () => lastRespondedAt,
    }),
  };
  return {
    gateways,
    saved,
    notices,
    republish: (at) => {
      if (seat !== null) {
        seat = { ...seat, publishedAt: at };
      }
    },
  };
}
