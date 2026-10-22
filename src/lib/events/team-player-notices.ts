import type { RoleRequestGateways } from "@/lib/auth/role-request";
import {
  type NotificationBroadcastWriter,
  notifyMembers,
} from "@/lib/notifications/notify-member";
import type { RsvpResponse } from "./event-rsvp";

/**
 * El aviso a quien publicó el reparto cuando uno de sus jugadores deja de ir
 * o vuelve a ir (#838). El jugador sigue en su equipo (E10 §6): decide el
 * coach, y para eso tiene que enterarse.
 *
 * Como mucho uno de cada tipo por jugador y publicación: cambiar de idea
 * cinco veces no llena la campana. Volver a publicar cuenta desde cero. Sin
 * quien publicó (un reparto de antes de `0079`, o su cuenta ya no está en el
 * club) el aviso va a los Admin activos.
 *
 * Nunca tumba la respuesta: el fallo queda en el log.
 */

export type TeamPlayerNoticeType =
  "team_player_dropped" | "team_player_returned";

/** El sitio de un jugador en el reparto publicado de un evento. */
export type PublishedSeat = {
  readonly publishedAt: Date;
  /** Null si se publicó antes de `0079` o quien publicó ya no está. */
  readonly publishedBy: string | null;
  readonly teamName: string;
};

export type TeamSeatsGateway = {
  /** Null sin reparto, con el reparto en borrador o con el jugador fuera de
   * él. */
  findPublishedSeat(query: {
    readonly clubId: string;
    readonly eventId: string;
    readonly userId: string;
  }): Promise<PublishedSeat | null>;
  /** Si ya salió un aviso de ese tipo por ese jugador y evento, a quien sea,
   * desde `since`. */
  hasPlayerNoticeSince(query: {
    readonly type: TeamPlayerNoticeType;
    readonly eventId: string;
    readonly playerId: string;
    readonly since: Date;
  }): Promise<boolean>;
};

export type TeamPlayerNoticeGateways = {
  readonly teamSeats: TeamSeatsGateway;
  readonly admins: RoleRequestGateways["admins"];
  readonly notifications: NotificationBroadcastWriter;
};

export type RsvpChange = {
  readonly clubId: string;
  readonly event: { readonly id: string; readonly title: string };
  readonly player: { readonly id: string; readonly fullName: string };
  readonly previous: RsvpResponse | null;
  readonly current: RsvpResponse;
};

/** "Quizás" sigue en la escuadra, como en `assertPlayersInSquad`. */
function isComing(response: RsvpResponse | null): boolean {
  return response === "yes" || response === "maybe";
}

function noticeTypeOf(change: RsvpChange): TeamPlayerNoticeType | null {
  if (isComing(change.previous) && change.current === "no") {
    return "team_player_dropped";
  }
  if (change.previous === "no" && isComing(change.current)) {
    return "team_player_returned";
  }
  return null;
}

async function wasNoticed(
  gateways: TeamPlayerNoticeGateways,
  query: {
    readonly type: TeamPlayerNoticeType;
    readonly change: RsvpChange;
    readonly seat: PublishedSeat;
  },
): Promise<boolean> {
  return gateways.teamSeats.hasPlayerNoticeSince({
    type: query.type,
    eventId: query.change.event.id,
    playerId: query.change.player.id,
    since: query.seat.publishedAt,
  });
}

/** Una vez de cada tipo; "vuelve" sólo si se avisó de que se iba. */
async function isDue(
  gateways: TeamPlayerNoticeGateways,
  query: {
    readonly type: TeamPlayerNoticeType;
    readonly change: RsvpChange;
    readonly seat: PublishedSeat;
  },
): Promise<boolean> {
  if (await wasNoticed(gateways, query)) {
    return false;
  }
  return (
    query.type === "team_player_dropped" ||
    wasNoticed(gateways, { ...query, type: "team_player_dropped" })
  );
}

async function recipientsOf(
  gateways: TeamPlayerNoticeGateways,
  request: { readonly change: RsvpChange; readonly seat: PublishedSeat },
): Promise<readonly string[]> {
  const { change, seat } = request;
  const candidates =
    seat.publishedBy === null
      ? await gateways.admins.listActiveAdminUserIds(change.clubId)
      : [seat.publishedBy];
  return candidates.filter((userId) => userId !== change.player.id);
}

async function sendTeamPlayerNotice(
  gateways: TeamPlayerNoticeGateways,
  change: RsvpChange,
  type: TeamPlayerNoticeType,
): Promise<void> {
  const seat = await gateways.teamSeats.findPublishedSeat({
    clubId: change.clubId,
    eventId: change.event.id,
    userId: change.player.id,
  });
  if (seat === null || !(await isDue(gateways, { type, change, seat }))) {
    return;
  }
  const recipientUserIds = await recipientsOf(gateways, { change, seat });
  if (recipientUserIds.length === 0) {
    return;
  }
  await notifyMembers(gateways.notifications, {
    type,
    data: {
      eventId: change.event.id,
      title: change.event.title,
      playerId: change.player.id,
      playerName: change.player.fullName,
      teamName: seat.teamName,
    },
    recipientUserIds,
  });
}

/** Avisa si el cambio lo pide. No lanza nunca. */
export async function noticeTeamPlayerChange(
  gateways: TeamPlayerNoticeGateways,
  change: RsvpChange,
): Promise<void> {
  const type = noticeTypeOf(change);
  if (type === null) {
    return;
  }
  try {
    await sendTeamPlayerNotice(gateways, change, type);
  } catch (error) {
    // Sin el nombre del jugador: el log no lleva datos personales.
    console.error("[events] aviso de reparto sin mandar", {
      eventId: change.event.id,
      playerId: change.player.id,
      type,
      error,
    });
  }
}
