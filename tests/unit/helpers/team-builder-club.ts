import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import type { ClubPosition } from "@/lib/club/club-positions";
import type { RsvpResponse } from "@/lib/events/event-rsvp";
import type {
  NotificationBroadcastWriter,
  NotificationInsert,
} from "@/lib/notifications/notify-member";
import type { PositionCoverage } from "@/lib/teams/squad";
import {
  BUILDABLE_EVENT_TYPES,
  type NewTeamSplit,
  type StoredTeamSplit,
  type TeamAssignment,
  type TeamBuilderEvent,
  type TeamBuilderGateways,
} from "@/lib/teams/team-builder";
import type { MyTeamGateways } from "@/lib/teams/my-team";
import { SEEDED_POSITIONS } from "./seeded-positions";

/**
 * Un club en memoria para los tests del team builder (#401). El doble cumple
 * el contrato del adaptador y de las funciones de `0047`: sólo encuentra
 * eventos del club que se le pide, guardar sustituye el reparto entero y lo
 * deja en borrador, y publicar devuelve la foto anterior y la nueva.
 */

export const TEAMS_CALLER_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
export const TEAMS_CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
export const OTHER_CLUB_ID = "5c1ab000-0000-4000-8000-000000000002";
export const SENIOR_SQUAD_ID = "9a9a9a9a-0000-4000-8000-000000000009";
export const EVENT_ID = "e1e1e1e1-0000-4000-8000-00000000000e";

/** 2027-06-15 20:00 en Melbourne (hora estándar, UTC+10). */
export const TEAMS_NOW = new Date("2027-06-15T10:00:00Z");

/** Cuando el doble publica. */
export const PUBLISHED_AT = new Date("2027-06-15T10:05:00Z");

/** El scrimmage del sábado siguiente, para todo el club. */
export const SCRIMMAGE: TeamBuilderEvent = {
  id: EVENT_ID,
  clubId: TEAMS_CLUB_ID,
  eventType: "training",
  title: "Scrimmage del sábado",
  status: "scheduled",
  startsOn: "2027-06-19",
  startTime: "10:00",
  audience: { kind: "club" },
};

export type FakePlayer = {
  readonly userId: string;
  readonly fullName: string;
  /** Sin respuesta si falta. */
  readonly response?: RsvpResponse;
  readonly positionId?: string;
  readonly coverage?: PositionCoverage;
  /** Sin evaluación si falta. */
  readonly ratings?: readonly number[];
};

export type FakeTeamsClubOptions = {
  readonly callerRole?: Role;
  readonly callerGroupIds?: readonly string[];
  readonly events?: readonly TeamBuilderEvent[];
  readonly players?: readonly FakePlayer[];
  readonly split?: StoredTeamSplit | null;
  /** Lo avisado en la última publicación. */
  readonly publishedAssignments?: readonly TeamAssignment[];
  readonly positions?: readonly ClubPosition[];
  /** Guardar los avisos falla siempre. */
  readonly failingNotifications?: boolean;
  /** Escribir en la bitácora falla siempre. */
  readonly failingAudit?: boolean;
};

export type SentNotice = {
  readonly type: string;
  readonly userId: string;
  readonly data: unknown;
};

export type FakeTeamsClub = {
  readonly gateways: TeamBuilderGateways;
  readonly myTeamGateways: MyTeamGateways;
  readonly split: () => StoredTeamSplit | null;
  readonly saves: NewTeamSplit[];
  readonly notices: SentNotice[];
  readonly auditRows: AuditLogInsertRow[];
};

export function playerId(index: number): string {
  return `4e4e4e4e-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function fakeNotifications(
  notices: SentNotice[],
  isFailing: boolean,
): NotificationBroadcastWriter {
  const record = (row: NotificationInsert): void => {
    if (isFailing) {
      throw new Error("La base de avisos no responde.");
    }
    notices.push({ type: row.type, userId: row.userId, data: row.data });
  };
  return {
    findRecipients: async (userIds) =>
      new Map(
        userIds.map((userId) => [
          userId,
          { clubId: TEAMS_CLUB_ID, accountStatus: "active" as const },
        ]),
      ),
    insertNotifications: async (rows) => {
      if (isFailing) {
        throw new Error("La base de avisos no responde.");
      }
      rows.forEach(record);
    },
    insertNotification: async (row) => record(row),
    pruneNotificationsOf: async () => new Map(),
    runAfterResponse: () => undefined,
  };
}

export function fakeTeamsClub(
  options: FakeTeamsClubOptions = {},
): FakeTeamsClub {
  const events = options.events ?? [SCRIMMAGE];
  const players = options.players ?? [];
  let split = options.split ?? null;
  let published = options.publishedAssignments ?? [];
  const saves: NewTeamSplit[] = [];
  const notices: SentNotice[] = [];
  const auditRows: AuditLogInsertRow[] = [];
  const members = {
    findRoleRequestMember: async () => ({
      clubId: TEAMS_CLUB_ID,
      fullName: "Carla Coach",
      role: options.callerRole ?? "Coach",
    }),
  };
  const teams: TeamBuilderGateways["teams"] = {
    findEvent: async ({ clubId, eventId }) =>
      events.find((event) => event.id === eventId && event.clubId === clubId) ??
      null,
    findBuildableEvents: async ({ clubId, today, limit }) =>
      events
        .filter(
          (event) =>
            event.clubId === clubId &&
            BUILDABLE_EVENT_TYPES.includes(event.eventType) &&
            event.status === "scheduled" &&
            event.startsOn >= today,
        )
        .sort((first, second) =>
          `${first.startsOn}T${first.startTime}`.localeCompare(
            `${second.startsOn}T${second.startTime}`,
          ),
        )
        .slice(0, limit)
        .map(({ id, title, eventType, startsOn, startTime }) => ({
          id,
          title,
          eventType,
          startsOn,
          startTime,
        })),
    findLiveResponses: async () =>
      players.flatMap((player) =>
        player.response === "yes" || player.response === "maybe"
          ? [{ userId: player.userId, response: player.response }]
          : [],
      ),
    findPlayers: async ({ userIds }) =>
      players
        .filter((player) => userIds.includes(player.userId))
        .map((player) => ({
          userId: player.userId,
          fullName: player.fullName,
          positionId: player.positionId ?? null,
          coverage: player.coverage ?? null,
          ratings: player.ratings ?? null,
        })),
    findSplit: async () => split,
    saveSplit: async (newSplit) => {
      saves.push(newSplit);
      split = {
        teams: newSplit.teams,
        mode: newSplit.mode,
        publishedAt: null,
        assignments: newSplit.assignments,
      };
      return "saved";
    },
    publishSplit: async () => {
      if (split === null || split.assignments.length === 0) {
        return { kind: "empty" };
      }
      const previous = published;
      published = split.assignments;
      split = { ...split, publishedAt: PUBLISHED_AT };
      return {
        kind: "published",
        publishedAt: PUBLISHED_AT,
        teams: split.teams,
        previous,
        current: published,
      };
    },
  };
  const positions = {
    findClubPositions: async () => options.positions ?? SEEDED_POSITIONS,
  };
  const gateways: TeamBuilderGateways = {
    members,
    teams,
    positions,
    notifications: fakeNotifications(
      notices,
      options.failingNotifications ?? false,
    ),
    audit: {
      insertAuditLogRow: async (row) => {
        if (options.failingAudit) {
          return { error: { message: "La bitácora no responde." } };
        }
        auditRows.push(row);
        return { error: null };
      },
    },
  };
  const myTeamGateways: MyTeamGateways = {
    members,
    memberGroups: {
      listGroupsOf: async () =>
        (options.callerGroupIds ?? []).map((id) => ({ id, name: id })),
    },
    teams,
    positions,
  };
  return {
    gateways,
    myTeamGateways,
    split: () => split,
    saves,
    notices,
    auditRows,
  };
}
