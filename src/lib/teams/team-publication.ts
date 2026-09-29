import { type AuditActor, recordAuditEvent } from "@/lib/audit/audit-log";
import { notifyMembers } from "@/lib/notifications/notify-member";
import {
  TEAM_IDS,
  type TeamAssignment,
  type TeamBuilderEvent,
  type TeamBuilderGateways,
  type TeamLabels,
  TeamSplitEmptyError,
  findBuildableEvent,
  findTeamBuilderActor,
  rejectionError,
} from "./team-builder";

/**
 * Publicar el reparto (#401, RF-7 del PRD de E10, FR-049, AC-020). La base
 * fija la fecha y devuelve lo avisado la vez anterior; aquí se decide a quién
 * avisar (D6): a quien entra o cambia de equipo, `team_assigned` con su
 * equipo y su color, y a quien sale, `team_unassigned`. Nunca a quien
 * publica. Publicar dos veces sin cambios no avisa a nadie la segunda.
 *
 * Los avisos van por `notifyMembers`, en bloque y sin lanzar: un fallo queda
 * en el log y el reparto sigue publicado.
 */

/** En la bitácora la entidad es el evento: "qué reparto". */
const AUDITED_ENTITY_TYPE = "event";

export type PublishedTeamSplit = {
  readonly eventId: string;
  readonly publishedAt: string;
  readonly assignedCount: number;
  /** A cuántos se intentó avisar: los que cambiaron, sin quien publica. */
  readonly notifiedCount: number;
};

export type PublicationNotices = {
  readonly assigned: readonly TeamAssignment[];
  readonly unassignedIds: readonly string[];
};

/** Quién cambió entre lo avisado antes y lo que se publica ahora (D6). */
export function diffPublishedAssignments(
  previous: readonly TeamAssignment[],
  current: readonly TeamAssignment[],
): PublicationNotices {
  const previousTeams = new Map(
    previous.map((assignment) => [assignment.userId, assignment.team]),
  );
  const currentIds = new Set(current.map((assignment) => assignment.userId));
  return {
    assigned: current.filter(
      (assignment) => previousTeams.get(assignment.userId) !== assignment.team,
    ),
    unassignedIds: previous
      .map((assignment) => assignment.userId)
      .filter((userId) => !currentIds.has(userId)),
  };
}

function withoutPublisher(
  notices: PublicationNotices,
  publisherId: string,
): PublicationNotices {
  return {
    assigned: notices.assigned.filter(
      (assignment) => assignment.userId !== publisherId,
    ),
    unassignedIds: notices.unassignedIds.filter((id) => id !== publisherId),
  };
}

/** Un aviso por equipo y otro para los que salen: en bloque, nunca uno a
 * uno. `notifyMembers` no lanza. */
async function sendPublicationNotices(
  gateways: Pick<TeamBuilderGateways, "notifications">,
  publication: {
    readonly event: TeamBuilderEvent;
    readonly teams: TeamLabels;
    readonly notices: PublicationNotices;
  },
): Promise<void> {
  const { event, teams, notices } = publication;
  const eventData = {
    eventId: event.id,
    title: event.title,
    startsOn: event.startsOn,
    startTime: event.startTime,
  };
  for (const team of TEAM_IDS) {
    const recipientUserIds = notices.assigned
      .filter((assignment) => assignment.team === team)
      .map((assignment) => assignment.userId);
    if (recipientUserIds.length > 0) {
      await notifyMembers(gateways.notifications, {
        type: "team_assigned",
        data: {
          ...eventData,
          teamName: teams[team].name,
          teamColor: teams[team].color,
        },
        recipientUserIds,
      });
    }
  }
  if (notices.unassignedIds.length > 0) {
    await notifyMembers(gateways.notifications, {
      type: "team_unassigned",
      data: eventData,
      recipientUserIds: notices.unassignedIds,
    });
  }
}

/** Quién, qué evento y cuántos, sin nombres (NFR-010). */
async function recordPublication(
  gateways: Pick<TeamBuilderGateways, "audit">,
  publication: {
    readonly actor: AuditActor;
    readonly eventId: string;
    readonly assignedCount: number;
  },
): Promise<void> {
  const { actor, eventId, assignedCount } = publication;
  await recordAuditEvent(gateways.audit, {
    actor,
    clubId: actor.clubId,
    action: "team_split.published",
    entityType: AUDITED_ENTITY_TYPE,
    entityId: eventId,
    result: "success",
    metadata: { assignedCount },
  });
}

export async function publishTeamSplit(
  gateways: TeamBuilderGateways,
  request: {
    readonly callerId: string;
    readonly eventId: string;
    readonly now: Date;
  },
): Promise<PublishedTeamSplit> {
  const actor = await findTeamBuilderActor(gateways, request.callerId);
  const event = await findBuildableEvent(gateways, {
    ...request,
    clubId: actor.clubId,
  });
  const publication = await gateways.teams.publishSplit({
    clubId: actor.clubId,
    eventId: event.id,
  });
  if (publication.kind === "empty") {
    throw new TeamSplitEmptyError();
  }
  if (publication.kind !== "published") {
    throw rejectionError(publication.kind);
  }
  const assignedCount = publication.current.length;
  const notices = withoutPublisher(
    diffPublishedAssignments(publication.previous, publication.current),
    actor.id,
  );
  // Avisar antes de la bitácora: la foto ya quedó guardada, y si la bitácora
  // fallara primero, al reintentar el diff saldría vacío y nadie se enteraría.
  await sendPublicationNotices(gateways, {
    event,
    teams: publication.teams,
    notices,
  });
  await recordPublication(gateways, {
    actor,
    eventId: event.id,
    assignedCount,
  });
  return {
    eventId: event.id,
    publishedAt: publication.publishedAt.toISOString(),
    assignedCount,
    notifiedCount: notices.assigned.length + notices.unassignedIds.length,
  };
}
