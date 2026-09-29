import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { hasCapability } from "@/lib/auth/roles";
import type {
  ClubPositionsGateway,
  NamedPosition,
} from "@/lib/club/club-positions";
import { EventNotFoundError, isInAudience } from "@/lib/events/event-rsvp";
import type { MemberGroupsGateway } from "@/lib/groups/member-groups";
import { compareNames } from "@/lib/text/name-order";
import {
  TEAM_IDS,
  type StoredTeamSplit,
  type TeamBuilderEvent,
  type TeamId,
  type TeamLabel,
  type TeamSplitsGateway,
  readSquadEntries,
} from "./team-builder";

/**
 * Lo que ve un miembro del reparto de un evento (#401, RF-8 del PRD de E10,
 * FR-048): su equipo, su posición y la alineación de los dos, con nombres y
 * posiciones y nunca un OVR (D3, FR-055).
 *
 * Cuelga del camino de lectura de eventos: lo alcanza cualquier cuenta
 * activa. Ve el evento quien lo ve en el calendario (su audiencia, o Admin y
 * Committee, que lo gestionan) y quien juega en el reparto aunque haya salido
 * de la audiencia, como en la policy de `0046`. Al resto, 404. Un borrador o
 * un reparto que no existe se responden igual: no hay equipos publicados.
 */

export type MyTeamGateways = {
  readonly members: Pick<
    RoleRequestGateways["members"],
    "findRoleRequestMember"
  >;
  readonly memberGroups: MemberGroupsGateway;
  readonly teams: Pick<
    TeamSplitsGateway,
    "findEvent" | "findSplit" | "findPlayers"
  >;
  readonly positions: ClubPositionsGateway;
};

export type LineupPlayer = {
  readonly userId: string;
  readonly fullName: string;
  readonly position: NamedPosition | null;
};

export type PublishedTeam = TeamLabel & {
  readonly players: readonly LineupPlayer[];
};

export type MyTeam =
  | { readonly status: "not_published" }
  | {
      readonly status: "published";
      readonly publishedAt: string;
      /** `null` si quien pregunta no está en ningún equipo. */
      readonly me: {
        readonly team: TeamId;
        readonly position: NamedPosition | null;
      } | null;
      readonly teams: { readonly [Team in TeamId]: PublishedTeam };
    };

const NOT_PUBLISHED: MyTeam = { status: "not_published" };

type Viewer = {
  readonly clubId: string;
  readonly isOrganizer: boolean;
  readonly groupIds: readonly string[];
};

async function findViewer(
  gateways: MyTeamGateways,
  callerId: string,
): Promise<Viewer> {
  const [caller, groups] = await Promise.all([
    gateways.members.findRoleRequestMember(callerId),
    gateways.memberGroups.listGroupsOf(callerId),
  ]);
  if (caller === null) {
    throw new MemberNotFoundError(callerId);
  }
  return {
    clubId: caller.clubId,
    // Admin y Committee ven todo el calendario, como en la agenda (#309).
    isOrganizer: hasCapability(caller.role, "createEvents"),
    groupIds: groups.map((group) => group.id),
  };
}

type PublishedSplit = StoredTeamSplit & { readonly publishedAt: Date };

/** Un borrador no lo ve nadie: cuenta como si no hubiera reparto. */
function asPublished(split: StoredTeamSplit | null): PublishedSplit | null {
  if (split === null || split.publishedAt === null) {
    return null;
  }
  return { ...split, publishedAt: split.publishedAt };
}

function isAssigned(split: PublishedSplit | null, userId: string): boolean {
  return (
    split !== null &&
    split.assignments.some((assignment) => assignment.userId === userId)
  );
}

function seesEvent(
  viewer: Viewer,
  event: TeamBuilderEvent,
  isPlaying: boolean,
): boolean {
  return (
    viewer.isOrganizer ||
    isPlaying ||
    isInAudience(event.audience, viewer.groupIds)
  );
}

function byName(first: LineupPlayer, second: LineupPlayer): number {
  return compareNames(first.fullName, second.fullName);
}

async function toLineups(
  gateways: MyTeamGateways,
  clubId: string,
  split: PublishedSplit,
): Promise<{ readonly [Team in TeamId]: PublishedTeam }> {
  const entries = await readSquadEntries(gateways, {
    clubId,
    userIds: split.assignments.map((assignment) => assignment.userId),
  });
  const lineupOf = (team: TeamId): PublishedTeam => ({
    ...split.teams[team],
    players: split.assignments
      .filter((assignment) => assignment.team === team)
      .flatMap((assignment) => {
        const entry = entries.get(assignment.userId);
        return entry === undefined
          ? []
          : [
              {
                userId: entry.userId,
                fullName: entry.fullName,
                position: entry.position,
              },
            ];
      })
      .sort(byName),
  });
  return { a: lineupOf("a"), b: lineupOf("b") };
}

function findMe(
  teams: { readonly [Team in TeamId]: PublishedTeam },
  callerId: string,
): { readonly team: TeamId; readonly position: NamedPosition | null } | null {
  for (const team of TEAM_IDS) {
    const player = teams[team].players.find(
      (candidate) => candidate.userId === callerId,
    );
    if (player !== undefined) {
      return { team, position: player.position };
    }
  }
  return null;
}

export async function openMyTeam(
  gateways: MyTeamGateways,
  request: { readonly callerId: string; readonly eventId: string },
): Promise<MyTeam> {
  const viewer = await findViewer(gateways, request.callerId);
  const event = await gateways.teams.findEvent({
    clubId: viewer.clubId,
    eventId: request.eventId,
  });
  if (event === null) {
    throw new EventNotFoundError();
  }
  const split = asPublished(await gateways.teams.findSplit(event.id));
  if (!seesEvent(viewer, event, isAssigned(split, request.callerId))) {
    throw new EventNotFoundError();
  }
  if (split === null) {
    return NOT_PUBLISHED;
  }
  const teams = await toLineups(gateways, viewer.clubId, split);
  return {
    status: "published",
    publishedAt: split.publishedAt.toISOString(),
    me: findMe(teams, request.callerId),
    teams,
  };
}
