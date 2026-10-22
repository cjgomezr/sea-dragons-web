import {
  type AttendanceSessionsGateways,
  listAttendanceSessions,
} from "@/lib/attendance/attendance-sessions";
import {
  CLUB_RATE_WINDOW_DAYS,
  type ClubAttendanceRate,
} from "@/lib/attendance/attendance-stats";
import type { ClubAttendanceRateGateways } from "@/lib/attendance/club-attendance-rate";
import {
  type ClubAdministrationGateways,
  listPendingRoleRequests,
} from "@/lib/auth/club-administration";
import { type Capability, type Role, hasCapability } from "@/lib/auth/roles";
import { clubCalendarDate, subtractClubDays } from "@/lib/time/club-calendar";
import type {
  DashboardNextUpEvent,
  StaffNextUpEvent,
} from "./dashboard-events";

/**
 * La columna de gestión del inicio (#746, RF-2, D3, D9, D10 y D11 del PRD de
 * E27): los pendientes y la tendencia de la asistencia del club.
 *
 * Cada pendiente sale sólo a quien puede resolverlo, según la matriz de
 * capacidades, y cada uno reutiliza la lectura de la sección que lo resuelve:
 * la bandeja de solicitudes, las sesiones para pasar lista y el reparto del
 * próximo evento.
 */

export type DashboardTodo =
  | { readonly kind: "role_requests"; readonly count: number }
  | {
      readonly kind: "attendance_missing";
      readonly eventId: string;
      readonly title: string;
      /** El día del club (YYYY-MM-DD) del entrenamiento. */
      readonly startsOn: string;
    }
  | {
      readonly kind: "teams_unpublished";
      readonly eventId: string;
      readonly title: string;
    }
  | {
      /** #838: asignados del reparto publicado que respondieron que no. */
      readonly kind: "teams_dropped";
      readonly eventId: string;
      readonly title: string;
      readonly count: number;
    }
  | {
      readonly kind: "no_reply";
      readonly eventId: string;
      readonly title: string;
      readonly count: number;
    };

export type UnansweredGateway = {
  /** Los socios activos de la audiencia del evento sin ninguna respuesta. */
  countUnanswered(query: {
    readonly clubId: string;
    readonly eventId: string;
  }): Promise<number>;
};

/** Quién publicó el reparto de un evento y cuáles de sus asignados
 * respondieron que no (#838). */
export type PublishedSplitDrops = {
  /** Null si se publicó antes de `0079` o quien publicó ya no está. */
  readonly publishedBy: string | null;
  readonly droppedUserIds: readonly string[];
};

export type DroppedPlayersGateway = {
  /** Null sin reparto publicado. */
  findDroppedPlayers(query: {
    readonly clubId: string;
    readonly eventId: string;
  }): Promise<PublishedSplitDrops | null>;
};

export type TodoGateways = {
  readonly administration: ClubAdministrationGateways;
  readonly attendanceSessions: AttendanceSessionsGateways;
  readonly unanswered: UnansweredGateway;
  readonly droppedPlayers: DroppedPlayersGateway;
};

/** Quien puede resolver alguno de los pendientes ve la columna (D3): el
 * Admin, el Coach y el Committee. */
const MANAGEMENT_CAPABILITIES: readonly Capability[] = [
  "manageUsersAndRoles",
  "buildTeamsAndTrackAttendance",
  "createEvents",
];

export function seesManagementColumn(role: Role): boolean {
  return MANAGEMENT_CAPABILITIES.some((capability) =>
    hasCapability(role, capability),
  );
}

export type TodosRequest = {
  readonly callerId: string;
  readonly clubId: string;
  readonly role: Role;
  readonly now: Date;
  /** El próximo evento de quien mira (D4), o null si no hay. */
  readonly nextEvent: DashboardNextUpEvent | StaffNextUpEvent | null;
};

const NOTHING: readonly DashboardTodo[] = [];

async function listRoleRequestTodos(
  gateways: TodoGateways,
  request: TodosRequest,
): Promise<readonly DashboardTodo[]> {
  if (!hasCapability(request.role, "manageUsersAndRoles")) {
    return NOTHING;
  }
  const pending = await listPendingRoleRequests(
    gateways.administration,
    request.callerId,
  );
  return pending.length === 0
    ? NOTHING
    : [{ kind: "role_requests", count: pending.length }];
}

/** El más reciente de los entrenamientos sin hoja, uno solo (D10). Las
 * sesiones llegan de la más reciente a la más antigua. */
async function listAttendanceTodos(
  gateways: TodoGateways,
  request: TodosRequest,
): Promise<readonly DashboardTodo[]> {
  if (!hasCapability(request.role, "buildTeamsAndTrackAttendance")) {
    return NOTHING;
  }
  const { sessions } = await listAttendanceSessions(
    gateways.attendanceSessions,
    { callerId: request.callerId, now: request.now },
  );
  const missing = sessions.find((session) => !session.hasSheet);
  if (missing === undefined) {
    return NOTHING;
  }
  return [
    {
      kind: "attendance_missing",
      eventId: missing.eventId,
      title: missing.title,
      startsOn: clubCalendarDate(new Date(missing.startsAt)),
    },
  ];
}

function listTeamsTodos(request: TodosRequest): readonly DashboardTodo[] {
  const event = request.nextEvent;
  const isDraft =
    event !== null && "teamsStatus" in event && event.teamsStatus === "draft";
  if (
    !isDraft ||
    !hasCapability(request.role, "buildTeamsAndTrackAttendance")
  ) {
    return NOTHING;
  }
  return [{ kind: "teams_unpublished", eventId: event.id, title: event.title }];
}

/** El mismo destinatario que el aviso de la campana: quien publicó o, si no
 * se sabe quién fue, los Admin. */
function isDropsRecipient(
  request: TodosRequest,
  publishedBy: string | null,
): boolean {
  return publishedBy === null
    ? request.role === "Admin"
    : publishedBy === request.callerId;
}

/** #838: el reparto publicado del próximo evento, a quien lo publicó. */
async function listDroppedTodos(
  gateways: TodoGateways,
  request: TodosRequest,
): Promise<readonly DashboardTodo[]> {
  const event = request.nextEvent;
  if (
    event === null ||
    !("teamsStatus" in event) ||
    event.teamsStatus !== "published"
  ) {
    return NOTHING;
  }
  const drops = await gateways.droppedPlayers.findDroppedPlayers({
    clubId: request.clubId,
    eventId: event.id,
  });
  if (drops === null || !isDropsRecipient(request, drops.publishedBy)) {
    return NOTHING;
  }
  const count = drops.droppedUserIds.filter(
    (userId) => userId !== request.callerId,
  ).length;
  return count === 0
    ? NOTHING
    : [{ kind: "teams_dropped", eventId: event.id, title: event.title, count }];
}

/** A todo el que ve la columna: sólo abre el evento (D9). */
async function listNoReplyTodos(
  gateways: TodoGateways,
  request: TodosRequest,
): Promise<readonly DashboardTodo[]> {
  const event = request.nextEvent;
  if (event === null) {
    return NOTHING;
  }
  const count = await gateways.unanswered.countUnanswered({
    clubId: request.clubId,
    eventId: event.id,
  });
  return count === 0
    ? NOTHING
    : [{ kind: "no_reply", eventId: event.id, title: event.title, count }];
}

/** En el orden de la columna (RF-6). */
export async function listTodos(
  gateways: TodoGateways,
  request: TodosRequest,
): Promise<readonly DashboardTodo[]> {
  const groups = await Promise.all([
    listRoleRequestTodos(gateways, request),
    listAttendanceTodos(gateways, request),
    listTeamsTodos(request),
    listDroppedTodos(gateways, request),
    listNoReplyTodos(gateways, request),
  ]);
  return groups.flat();
}

/** Cada porcentaje es null si su periodo no tiene hojas. */
export type ClubAttendanceTrend = {
  readonly percent: number | null;
  readonly previousPercent: number | null;
};

function percentOf(rate: ClubAttendanceRate): number | null {
  return rate.kind === "rate" ? rate.percent : null;
}

/** La tasa de hoy y los 29 días anteriores, comparada con la de los 30 días
 * de antes (D11). Sin el cerrojo de `readClubAttendanceRate`: el Committee
 * también la ve en el inicio, aunque no pueda abrir Asistencia. */
export async function readClubAttendanceTrend(
  gateway: ClubAttendanceRateGateways["clubRate"],
  request: { readonly clubId: string; readonly today: string },
): Promise<ClubAttendanceTrend> {
  const currentSince = subtractClubDays(
    request.today,
    CLUB_RATE_WINDOW_DAYS - 1,
  );
  const previousUntil = subtractClubDays(currentSince, 1);
  const [current, previous] = await Promise.all([
    gateway.findClubAttendanceRate(request.clubId, {
      since: currentSince,
      until: request.today,
    }),
    gateway.findClubAttendanceRate(request.clubId, {
      since: subtractClubDays(previousUntil, CLUB_RATE_WINDOW_DAYS - 1),
      until: previousUntil,
    }),
  ]);
  return { percent: percentOf(current), previousPercent: percentOf(previous) };
}
