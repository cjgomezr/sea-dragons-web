import type {
  ClubAttendanceRate,
  MemberAttendance,
} from "@/lib/attendance/attendance-stats";
import {
  type ClubAttendanceRateGateways,
  readClubAttendanceRate,
} from "@/lib/attendance/club-attendance-rate";
import {
  type OwnAttendanceGateways,
  readOwnAttendance,
} from "@/lib/attendance/own-attendance";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { type Role, hasCapability } from "@/lib/auth/roles";
import {
  type AgendaEvent,
  type EventAgendaGateways,
  listAgenda,
} from "@/lib/events/event-agenda";
import { isStillAhead } from "@/lib/events/event-occurrences";
import type { RsvpResponse } from "@/lib/events/event-rsvp";
import {
  type NewsFeedItem,
  type NewsFeedPage,
  listNewsFeed,
} from "@/lib/news/news-feed";
import type { NewsCategory, NewsGateways } from "@/lib/news/news-posts";
import {
  clubCalendarDate,
  clubMoment,
  subtractClubDays,
} from "@/lib/time/club-calendar";

/**
 * El dashboard de la pantalla de inicio (#424, RF-1, RF-2, RF-5 y RF-6 del
 * PRD de E14) en una sola respuesta.
 *
 * Nada se recalcula aquí: cada parte sale de la función de dominio que ya
 * sirve su sección (la tasa del club, la asistencia propia, la agenda y el
 * feed), así que el dashboard ve exactamente lo que vería quien entrara en
 * ella. Las fuentes se piden a la vez y cada una puede caer sola: la que
 * falla llega como `unavailable`, se apunta en el log con su causa, y el
 * resto se sirve igual (RF-6).
 */

/** Cuántos eventos y noticias enseña el inicio (FR-077). */
export const DASHBOARD_LIST_SIZE = 3;

/** Los días hacia atrás que cubren las altas y, sin marca de visita, las
 * noticias sin leer (D2). */
export const DASHBOARD_WINDOW_DAYS = 30;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type Unavailable = { readonly kind: "unavailable" };

/** La primera tesela según el rol (D1). */
export type AttendanceTile =
  | { readonly kind: "club_rate"; readonly rate: ClubAttendanceRate }
  | { readonly kind: "own_attendance"; readonly attendance: MemberAttendance }
  | Unavailable;

export type MembersTile =
  | {
      readonly kind: "members";
      readonly active: number;
      /** Cuántos de los activos se unieron en los últimos 30 días. */
      readonly joinedRecently: number;
    }
  | Unavailable;

export type NextTraining = {
  readonly id: string;
  readonly title: string;
  readonly startsOn: string;
  readonly startTime: string;
  readonly location: string;
  readonly myResponse: RsvpResponse | null;
};

export type NextTrainingTile =
  | { readonly kind: "training"; readonly training: NextTraining }
  | { readonly kind: "none" }
  | Unavailable;

export type UnreadNewsTile =
  | {
      readonly kind: "unread";
      readonly count: number;
      readonly announcements: number;
    }
  | Unavailable;

export type UpcomingEvents =
  | { readonly kind: "events"; readonly events: readonly AgendaEvent[] }
  | Unavailable;

export type LatestNewsItem = {
  readonly id: string;
  readonly category: NewsCategory;
  readonly title: string;
  readonly publishedAt: string;
};

export type LatestNews =
  | { readonly kind: "news"; readonly posts: readonly LatestNewsItem[] }
  | Unavailable;

export type Dashboard = {
  readonly tiles: {
    readonly attendance: AttendanceTile;
    readonly members: MembersTile;
    readonly nextTraining: NextTrainingTile;
    readonly unreadNews: UnreadNewsTile;
  };
  readonly upcomingEvents: UpcomingEvents;
  readonly latestNews: LatestNews;
};

export type ActiveMembers = {
  readonly active: number;
  readonly joinedRecently: number;
};

/** Lo que el dashboard lee de `members` y ninguna sección servía ya. */
export type DashboardRosterGateway = {
  /** Los socios `active` del club, y cuántos con `joined_on` desde
   * `joinedSince` (YYYY-MM-DD del club, incluido). */
  countActiveMembers(query: {
    readonly clubId: string;
    readonly joinedSince: string;
  }): Promise<ActiveMembers>;
  /** La última visita a Noticias, o `null` si nunca las abrió. */
  findNewsSeenAt(userId: string): Promise<string | null>;
};

/** Las partes que pueden caer por separado, para el log. */
export type DashboardSource =
  "attendance" | "members" | "agenda" | "news" | "news_seen";

export type DashboardFailureLog = {
  report(source: DashboardSource, error: unknown): void;
};

export type DashboardGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly clubRate: ClubAttendanceRateGateways;
  readonly ownAttendance: OwnAttendanceGateways;
  readonly agenda: EventAgendaGateways;
  readonly news: NewsGateways;
  readonly roster: DashboardRosterGateway;
  readonly failures: DashboardFailureLog;
};

export type DashboardRequest = {
  readonly callerId: string;
  readonly now: Date;
};

const UNAVAILABLE: Unavailable = { kind: "unavailable" };

/** Admin y Coach, los que pasan lista, ven la tasa del club (D1). */
function seesClubRate(role: Role): boolean {
  return hasCapability(role, "buildTeamsAndTrackAttendance");
}

async function readAttendanceTile(
  gateways: DashboardGateways,
  request: DashboardRequest & { readonly role: Role },
): Promise<AttendanceTile> {
  if (seesClubRate(request.role)) {
    return {
      kind: "club_rate",
      rate: await readClubAttendanceRate(gateways.clubRate, {
        callerId: request.callerId,
        todayInClub: clubCalendarDate(request.now),
      }),
    };
  }
  return {
    kind: "own_attendance",
    attendance: await readOwnAttendance(
      gateways.ownAttendance,
      request.callerId,
    ),
  };
}

async function readMembersTile(
  gateways: DashboardGateways,
  request: { readonly clubId: string; readonly now: Date },
): Promise<MembersTile> {
  const counts = await gateways.roster.countActiveMembers({
    clubId: request.clubId,
    // Hoy y los 29 días anteriores, como la tasa del club.
    joinedSince: subtractClubDays(
      clubCalendarDate(request.now),
      DASHBOARD_WINDOW_DAYS - 1,
    ),
  });
  return { kind: "members", ...counts };
}

/** Lo que el inicio puede enseñar como "próximo": dirigido a quien mira,
 * no cancelado y que todavía no empezó en la hora del club (RF-3). */
function isAheadForViewer(event: AgendaEvent, now: Date): boolean {
  return (
    event.inAudience &&
    event.status === "scheduled" &&
    isStillAhead(
      { date: event.startsOn, time: event.startTime },
      clubMoment(now),
    )
  );
}

function toNextTrainingTile(events: readonly AgendaEvent[]): NextTrainingTile {
  const training = events.find((event) => event.eventType === "training");
  if (training === undefined) {
    return { kind: "none" };
  }
  return {
    kind: "training",
    training: {
      id: training.id,
      title: training.title,
      startsOn: training.startsOn,
      startTime: training.startTime,
      location: training.location,
      myResponse: training.myResponse,
    },
  };
}

/** La primera página de próximos: 50 eventos sobran para encontrar tres y
 * un entrenamiento. */
async function readUpcomingAhead(
  gateways: DashboardGateways,
  request: DashboardRequest,
): Promise<readonly AgendaEvent[]> {
  const page = await listAgenda(gateways.agenda, {
    callerId: request.callerId,
    period: "upcoming",
    now: request.now,
  });
  return page.events.filter((event) => isAheadForViewer(event, request.now));
}

/** Retirada sólo le llega a quien la publicó; no es algo que leer. */
function isReadable(post: NewsFeedItem): boolean {
  return post.status === "published";
}

function toLatestNews(page: NewsFeedPage): LatestNews {
  return {
    kind: "news",
    posts: page.posts
      .filter(isReadable)
      .slice(0, DASHBOARD_LIST_SIZE)
      .map((post) => ({
        id: post.id,
        category: post.category,
        title: post.title,
        publishedAt: post.publishedAt,
      })),
  };
}

type UnreadCount = { readonly count: number; readonly announcements: number };

/** Recorre el feed desde `page` mientras siga habiendo publicaciones
 * posteriores a `sinceMs`. El feed va de la más reciente a la más antigua,
 * así que la primera anterior cierra la cuenta. */
async function countUnreadFrom(
  gateways: DashboardGateways,
  request: {
    readonly callerId: string;
    readonly page: NewsFeedPage;
    readonly sinceMs: number;
  },
): Promise<UnreadCount> {
  const fresh = request.page.posts.filter(
    (post) => Date.parse(post.publishedAt) > request.sinceMs,
  );
  const readable = fresh.filter(isReadable);
  const here = {
    count: readable.length,
    announcements: readable.filter((post) => post.category === "announcement")
      .length,
  };
  const reachedOlder = fresh.length < request.page.posts.length;
  if (reachedOlder || request.page.nextCursor === null) {
    return here;
  }
  const next = await countUnreadFrom(gateways, {
    ...request,
    page: await listNewsFeed(gateways.news, {
      callerId: request.callerId,
      cursor: request.page.nextCursor,
    }),
  });
  return {
    count: here.count + next.count,
    announcements: here.announcements + next.announcements,
  };
}

async function readUnreadNewsTile(
  gateways: DashboardGateways,
  request: DashboardRequest & {
    readonly firstPage: NewsFeedPage;
    readonly seenAt: string | null;
  },
): Promise<UnreadNewsTile> {
  const sinceMs =
    request.seenAt === null
      ? request.now.getTime() - DASHBOARD_WINDOW_DAYS * DAY_IN_MS
      : Date.parse(request.seenAt);
  const unread = await countUnreadFrom(gateways, {
    callerId: request.callerId,
    page: request.firstPage,
    sinceMs,
  });
  return { kind: "unread", ...unread };
}

/** Lo que devuelve la fuente, o `unavailable` con el fallo en el log. Es el
 * único sitio donde se atrapa: una fuente caída no tumba las demás (RF-6). */
async function orUnavailable<T>(
  gateways: DashboardGateways,
  source: DashboardSource,
  read: Promise<T>,
): Promise<T | Unavailable> {
  try {
    return await read;
  } catch (error) {
    gateways.failures.report(source, error);
    return UNAVAILABLE;
  }
}

function isUnavailable<T>(value: T | Unavailable): value is Unavailable {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "unavailable"
  );
}

type EventParts = {
  readonly nextTraining: NextTrainingTile;
  readonly upcomingEvents: UpcomingEvents;
};

async function readEventParts(
  gateways: DashboardGateways,
  request: DashboardRequest,
): Promise<EventParts> {
  const events = await orUnavailable(
    gateways,
    "agenda",
    readUpcomingAhead(gateways, request),
  );
  if (isUnavailable(events)) {
    return { nextTraining: UNAVAILABLE, upcomingEvents: UNAVAILABLE };
  }
  return {
    nextTraining: toNextTrainingTile(events),
    upcomingEvents: {
      kind: "events",
      events: events.slice(0, DASHBOARD_LIST_SIZE),
    },
  };
}

type NewsParts = {
  readonly unreadNews: UnreadNewsTile;
  readonly latestNews: LatestNews;
};

/** La primera página del feed sirve a las dos partes; sin la marca de
 * visita sólo cae la cuenta sin leer. */
async function readNewsParts(
  gateways: DashboardGateways,
  request: DashboardRequest,
): Promise<NewsParts> {
  const [firstPage, seenAt] = await Promise.all([
    orUnavailable(
      gateways,
      "news",
      listNewsFeed(gateways.news, { callerId: request.callerId }),
    ),
    orUnavailable(
      gateways,
      "news_seen",
      gateways.roster.findNewsSeenAt(request.callerId),
    ),
  ]);
  if (isUnavailable(firstPage)) {
    return { unreadNews: UNAVAILABLE, latestNews: UNAVAILABLE };
  }
  const latestNews = toLatestNews(firstPage);
  if (isUnavailable(seenAt)) {
    return { unreadNews: UNAVAILABLE, latestNews };
  }
  const unreadNews = await orUnavailable(
    gateways,
    "news",
    readUnreadNewsTile(gateways, { ...request, firstPage, seenAt }),
  );
  return { unreadNews, latestNews };
}

export async function readDashboard(
  gateways: DashboardGateways,
  request: DashboardRequest,
): Promise<Dashboard> {
  const caller = await gateways.members.findRoleRequestMember(request.callerId);
  if (caller === null) {
    throw new MemberNotFoundError(request.callerId);
  }
  const [attendance, members, eventParts, newsParts] = await Promise.all([
    orUnavailable(
      gateways,
      "attendance",
      readAttendanceTile(gateways, { ...request, role: caller.role }),
    ),
    orUnavailable(
      gateways,
      "members",
      readMembersTile(gateways, { clubId: caller.clubId, now: request.now }),
    ),
    readEventParts(gateways, request),
    readNewsParts(gateways, request),
  ]);
  return {
    tiles: {
      attendance,
      members,
      nextTraining: eventParts.nextTraining,
      unreadNews: newsParts.unreadNews,
    },
    upcomingEvents: eventParts.upcomingEvents,
    latestNews: newsParts.latestNews,
  };
}
