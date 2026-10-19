import { type Role, hasCapability } from "@/lib/auth/roles";
import type { NamedPosition } from "@/lib/club/club-positions";
import type {
  AgendaEvent,
  EventAgendaGateways,
  NamedEventAudience,
} from "@/lib/events/event-agenda";
import { signEventCover } from "@/lib/events/event-covers";
import type { EventType } from "@/lib/events/event-creation";
import type { EventPlace } from "@/lib/events/event-place";
import type { RsvpResponse } from "@/lib/events/event-rsvp";
import { type MyTeamGateways, openMyTeam } from "@/lib/teams/my-team";
import type { StoredTeamSplit } from "@/lib/teams/team-builder";
import {
  type ClubMoment,
  addClubDays,
  clubCalendarDate,
  clubMoment,
} from "@/lib/time/club-calendar";

/**
 * El próximo evento y la semana del inicio (#745, RF-2, D4, D5, D6 y D14 del
 * PRD de E27), sacados de la misma agenda que el calendario.
 *
 * Los dos se quedan con lo que va dirigido a quien mira, de cualquier tipo:
 * no hay regla por rol (D5). Un evento sigue contando mientras no termina,
 * así que la agenda de próximos no basta: un evento de varios días que
 * empezó antes de hoy sólo sale en la de pasados.
 */

/** La franja de la semana: hoy y los seis días siguientes (D14). */
export const DASHBOARD_WEEK_DAYS = 7;

/** El equipo de quien mira en el reparto publicado (D6). */
export type NextUpTeam = {
  readonly name: string;
  readonly color: string;
  readonly position: NamedPosition | null;
};

/** Lo que el Team builder tiene guardado para el evento. */
export type TeamsStatus = "none" | "draft" | "published";

export type DashboardNextUpEvent = {
  readonly kind: "event";
  readonly id: string;
  readonly title: string;
  readonly eventType: EventType;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly startTime: string;
  readonly endTime: string | null;
  readonly location: string;
  readonly place: EventPlace | null;
  /** La imagen grande firmada, o null sin imagen. */
  readonly coverUrl: string | null;
  readonly audience: NamedEventAudience;
  readonly goingCount: number;
  readonly maybeCount: number;
  readonly myResponse: RsvpResponse | null;
  /** Null sin reparto publicado, fuera de él o con la membresía sin pagar. */
  readonly myTeam: NextUpTeam | null;
};

/** Admin y Coach, los que arman, saben además si falta publicar. */
export type StaffNextUpEvent = DashboardNextUpEvent & {
  readonly teamsStatus: TeamsStatus;
};

export type WeekEvent = {
  readonly id: string;
  readonly title: string;
  readonly eventType: EventType;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly startTime: string;
  readonly endTime: string | null;
  readonly location: string;
  readonly myResponse: RsvpResponse | null;
};

/** Los eventos de la agenda que todavía pueden contar: los que empiezan de
 * hoy en adelante y los que empezaron antes, del más reciente al más
 * antiguo. */
export type AgendaWindow = {
  readonly upcoming: readonly AgendaEvent[];
  readonly started: readonly AgendaEvent[];
};

export type DashboardEventGateways = {
  readonly agenda: EventAgendaGateways;
  readonly myTeam: MyTeamGateways;
};

function lastDayOf(event: AgendaEvent): string {
  return event.endsOn ?? event.startsOn;
}

/** Si todavía no terminó: hasta su hora de fin o, sin ella, hasta el final
 * de su último día (D4). */
function isNotOver(event: AgendaEvent, now: ClubMoment): boolean {
  const lastDay = lastDayOf(event);
  if (lastDay !== now.date || event.endTime === null) {
    return lastDay >= now.date;
  }
  return event.endTime > now.time;
}

function isOwnAndScheduled(event: AgendaEvent): boolean {
  return event.inAudience && event.status === "scheduled";
}

/** Los dos tramos de la agenda en orden de inicio. Los empezados vienen del
 * más reciente al más antiguo y todos son de antes de hoy. */
function inStartOrder(window: AgendaWindow): readonly AgendaEvent[] {
  return [...window.started].reverse().concat(window.upcoming);
}

/** El primero que todavía no terminó, o null si no hay ninguno. */
export function findNextUpCandidate(
  window: AgendaWindow,
  now: Date,
): AgendaEvent | null {
  const moment = clubMoment(now);
  return (
    inStartOrder(window).find(
      (event) => isOwnAndScheduled(event) && isNotOver(event, moment),
    ) ?? null
  );
}

function toWeekEvent(event: AgendaEvent): WeekEvent {
  return {
    id: event.id,
    title: event.title,
    eventType: event.eventType,
    startsOn: event.startsOn,
    endsOn: event.endsOn,
    startTime: event.startTime,
    endTime: event.endTime,
    location: event.location,
    myResponse: event.myResponse,
  };
}

/** Los que ocupan algún día de hoy a hoy + 6, por inicio (D14). */
export function listWeekEvents(
  window: AgendaWindow,
  now: Date,
): readonly WeekEvent[] {
  const today = clubCalendarDate(now);
  const lastDay = addClubDays(today, DASHBOARD_WEEK_DAYS - 1);
  return inStartOrder(window)
    .filter(
      (event) =>
        isOwnAndScheduled(event) &&
        event.startsOn <= lastDay &&
        lastDayOf(event) >= today,
    )
    .map(toWeekEvent);
}

function teamsStatusOf(split: StoredTeamSplit | null): TeamsStatus {
  if (split === null) {
    return "none";
  }
  return split.publishedAt === null ? "draft" : "published";
}

/** Admin y Coach, los que arman los equipos. */
function seesTeamsStatus(role: Role): boolean {
  return hasCapability(role, "buildTeamsAndTrackAttendance");
}

export type NextUpRequest = {
  readonly event: AgendaEvent;
  readonly callerId: string;
  readonly clubId: string;
  readonly role: Role;
  /** Sin la membresía al día no hay franja de equipo (RF-2). */
  readonly isRestricted: boolean;
};

async function readMyTeam(
  gateways: DashboardEventGateways,
  request: NextUpRequest,
): Promise<NextUpTeam | null> {
  const team = await openMyTeam(gateways.myTeam, {
    callerId: request.callerId,
    eventId: request.event.id,
  });
  if (team.status === "not_published" || team.me === null) {
    return null;
  }
  const { name, color } = team.teams[team.me.team];
  return { name, color, position: team.me.position };
}

type TeamParts = {
  readonly myTeam: NextUpTeam | null;
  readonly teamsStatus: TeamsStatus;
};

/** El reparto se lee una vez para el estado; la franja sólo se busca si
 * está publicado y quien mira puede verla. */
async function readTeamParts(
  gateways: DashboardEventGateways,
  request: NextUpRequest,
): Promise<TeamParts> {
  const teamsStatus = teamsStatusOf(
    await gateways.myTeam.teams.findSplit(request.event.id),
  );
  const showsTeam = teamsStatus === "published" && !request.isRestricted;
  return {
    teamsStatus,
    myTeam: showsTeam ? await readMyTeam(gateways, request) : null,
  };
}

/** Lo que la agenda no trae: la audiencia con nombres y la imagen grande. */
async function readEventDetails(
  gateways: DashboardEventGateways,
  request: NextUpRequest,
): Promise<Pick<DashboardNextUpEvent, "audience" | "coverUrl">> {
  const row = await gateways.agenda.agenda.findEvent({
    clubId: request.clubId,
    callerId: request.callerId,
    eventId: request.event.id,
  });
  if (row === null) {
    throw new Error(
      `El evento ${request.event.id} salió en la agenda y ya no existe.`,
    );
  }
  if (row.coverUploadId === null) {
    return { audience: row.audience, coverUrl: null };
  }
  const { coverUrl } = await signEventCover(gateways.agenda.eventCovers, {
    id: row.coverUploadId,
    clubId: request.clubId,
  });
  return { audience: row.audience, coverUrl };
}

function toNextUpEvent(
  event: AgendaEvent,
  extras: Pick<DashboardNextUpEvent, "audience" | "coverUrl" | "myTeam">,
): DashboardNextUpEvent {
  return {
    kind: "event",
    id: event.id,
    title: event.title,
    eventType: event.eventType,
    startsOn: event.startsOn,
    endsOn: event.endsOn,
    startTime: event.startTime,
    endTime: event.endTime,
    location: event.location,
    place: event.place,
    coverUrl: extras.coverUrl,
    audience: extras.audience,
    goingCount: event.goingCount,
    maybeCount: event.maybeCount,
    myResponse: event.myResponse,
    myTeam: extras.myTeam,
  };
}

/** El próximo con su imagen, su audiencia y su reparto. Al Committee y al
 * Player no se les manda el estado del reparto (RF-2), así que a uno de
 * ellos sin la membresía al día no hace falta ni leerlo. */
export async function readNextUpEvent(
  gateways: DashboardEventGateways,
  request: NextUpRequest,
): Promise<DashboardNextUpEvent | StaffNextUpEvent> {
  const isStaff = seesTeamsStatus(request.role);
  if (!isStaff && request.isRestricted) {
    const details = await readEventDetails(gateways, request);
    return toNextUpEvent(request.event, { ...details, myTeam: null });
  }
  const [details, teams] = await Promise.all([
    readEventDetails(gateways, request),
    readTeamParts(gateways, request),
  ]);
  const nextUp = toNextUpEvent(request.event, {
    ...details,
    myTeam: teams.myTeam,
  });
  return isStaff ? { ...nextUp, teamsStatus: teams.teamsStatus } : nextUp;
}
