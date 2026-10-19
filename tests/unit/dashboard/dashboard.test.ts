import { beforeEach, describe, expect, it } from "vitest";
import {
  fakeAuthorPhotosGateway,
  fakeCoverlessGateway,
  fakeImagelessGateway,
} from "../helpers/news-club";
import type {
  ClubAttendanceRate,
  MemberAttendance,
} from "@/lib/attendance/attendance-stats";
import type { ClubRateWindow } from "@/lib/attendance/club-attendance-rate";
import type { RecentTraining } from "@/lib/attendance/attendance-sessions";
import type {
  AttendedSession,
  MemberSessionsQuery,
} from "@/lib/attendance/season-attendance";
import type { PendingRoleRequestRecord } from "@/lib/auth/club-administration";
import type { Role } from "@/lib/auth/roles";
import type { AttendanceStatus } from "@/lib/attendance/attendance-status";
import {
  type Dashboard,
  type DashboardGateways,
  type DashboardNextUpEvent,
  type DashboardSource,
  type DashboardTodo,
  type ManagementColumn,
  type MemberDashboard,
  type RestrictedDashboard,
  readDashboard,
} from "@/lib/dashboard/dashboard";
import type {
  MembershipRecord,
  MembershipStatus,
} from "@/lib/membership/membership";
import type { EventType } from "@/lib/events/event-creation";
import type {
  AgendaQuery,
  EventRow,
  EventStatus,
  RsvpTally,
} from "@/lib/events/event-agenda";
import type { RsvpResponse } from "@/lib/events/event-rsvp";
import type { PlayerRecord, StoredTeamSplit } from "@/lib/teams/team-builder";
import { DEFAULT_TEAM_LABELS } from "@/lib/teams/team-builder";
import { GOALKEEPER, SEEDED_POSITIONS } from "../helpers/seeded-positions";
import type {
  NewsCategory,
  NewsFeedQuery,
  NewsFeedRow,
  NewsPinnedFeedRow,
  NewsPostStatus,
} from "@/lib/news/news-posts";
import type {
  EmergencyContact,
  ProfileContact,
} from "@/lib/members/profile-contact";

/**
 * El dashboard de E14 (#424, RF-1, RF-2, RF-5 y RF-6) sin Supabase delante.
 * Los gateways son de memoria y los consumen las mismas funciones que sirven
 * cada sección; aquí se prueba qué se pide a cada una y cómo se junta.
 */

const CALLER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const COACHES_GROUP = "0a000000-0000-4000-8000-00000000000c";

// 30 de septiembre de 2026 a las 18:00 en Melbourne (AEST, UTC+10).
const NOW = new Date("2026-09-30T08:00:00.000Z");
const TODAY_IN_CLUB = "2026-09-30";

const SISTER: EmergencyContact = {
  name: "Lucía Ferrer",
  phone: "0412 999 888",
  relationship: "Hermana",
};

type FakeSource =
  | "clubRate"
  | "attendance"
  | "agenda"
  | "feed"
  | "roster"
  | "newsSeen"
  | "contact"
  | "eventDetail"
  | "teams"
  | "season"
  | "roleRequests"
  | "sessions"
  | "unanswered";

type Club = {
  role: Role;
  groupIds: string[];
  events: EventRow[];
  posts: NewsFeedRow[];
  /** La fijada vigente, que el feed trae aparte de `posts` (#592). */
  pinned: NewsPinnedFeedRow | null;
  clubRate: ClubAttendanceRate;
  /** La tasa de una ventana concreta, por su primer día; las demás dan
   * `clubRate`. */
  clubRatesBySince: Map<string, ClubAttendanceRate>;
  ownAttendance: MemberAttendance;
  activeMembers: { active: number; joinedRecently: number };
  newsSeenAt: string | null;
  /** El teléfono y el contacto de emergencia de quien mira (#498). */
  contact: ProfileContact;
  /** La membresía de quien mira; `null` si no tiene. */
  membership: MembershipRecord | null;
  /** Los conteos de respuestas por evento. */
  tallies: RsvpTally[];
  /** El reparto de cada evento, por id. */
  splits: Map<string, StoredTeamSplit>;
  /** Los jugadores que puede leer el reparto. */
  players: PlayerRecord[];
  /** Las portadas de noticias que existen en el bucket, por id. */
  newsCoverIds: Set<string>;
  /** `club_settings.season_starts_on` (#744). */
  seasonStartsOn: string | null;
  /** Todas las sesiones elegibles de quien mira, de la más vieja a la más
   * nueva. */
  ownSessions: AttendedSession[];
  /** Las solicitudes de rol pendientes del club. */
  pendingRequests: PendingRoleRequestRecord[];
  /** Los entrenamientos programados del club, con su hoja. */
  recentTrainings: RecentTraining[];
  /** Cuántos de la audiencia no respondieron, por evento. */
  unanswered: Map<string, number>;
  failing: Set<FakeSource>;
};

let club: Club;
const clubRateWindows: ClubRateWindow[] = [];
const joinedSinceAsked: string[] = [];
const sessionQueries: Omit<MemberSessionsQuery, "clubId">[] = [];
const reported: { source: DashboardSource; error: unknown }[] = [];

function failIf(source: FakeSource): void {
  if (club.failing.has(source)) {
    throw new Error(`la base no contesta: ${source}`);
  }
}

const SIGNED_URL_PREFIX = "https://storage.test/";

let nextId = 0;
function uuid(): string {
  nextId += 1;
  return `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`;
}

function event(overrides: {
  startsOn: string;
  startTime: string;
  endTime?: string | null;
  endsOn?: string | null;
  eventType?: EventType;
  status?: EventStatus;
  groupIds?: string[];
  title?: string;
  coverUploadId?: string | null;
  myResponse?: RsvpResponse | null;
}): EventRow {
  const { groupIds, ...rest } = overrides;
  return {
    id: uuid(),
    startsAt: `${overrides.startsOn}T${overrides.startTime}:00+10:00`,
    endTime: null,
    endsOn: null,
    title: "Entrenamiento del miércoles",
    eventType: "training",
    location: "MSAC",
    place: null,
    placeDetail: null,
    notes: null,
    coverUploadId: null,
    status: "scheduled",
    seriesId: null,
    audience:
      groupIds === undefined
        ? { kind: "club" }
        : {
            kind: "groups",
            groups: groupIds.map((id) => ({ id, name: "Grupo" })),
          },
    myResponse: null,
    ...rest,
  };
}

function post(overrides: {
  publishedAt: string;
  category?: NewsCategory;
  status?: NewsPostStatus;
  title?: string;
  body?: string;
  coverUploadId?: string | null;
}): NewsFeedRow {
  return {
    id: uuid(),
    category: "news",
    title: "Crónica del torneo",
    body: "Ganamos los tres partidos.",
    author: { id: CALLER_ID, fullName: "Alba Ferrer" },
    status: "published",
    attachmentCount: 0,
    coverUploadId: null,
    ...overrides,
  };
}

function isVisible(row: EventRow, query: AgendaQuery): boolean {
  if (query.visibility.kind === "club" || row.audience.kind === "club") {
    return true;
  }
  const { groupIds } = query.visibility;
  return row.audience.groups.some((group) => groupIds.includes(group.id));
}

function isInPeriod(row: EventRow, query: AgendaQuery): boolean {
  return query.period === "upcoming"
    ? row.startsOn >= query.today
    : row.startsOn < query.today;
}

function findAgendaPage(query: AgendaQuery): readonly EventRow[] {
  failIf("agenda");
  const direction = query.period === "upcoming" ? 1 : -1;
  return club.events
    .filter((row) => isInPeriod(row, query) && isVisible(row, query))
    .sort(
      (first, second) =>
        direction * first.startsAt.localeCompare(second.startsAt),
    )
    .slice(0, query.limit);
}

function findEvent(eventId: string): EventRow | null {
  failIf("eventDetail");
  return club.events.find((row) => row.id === eventId) ?? null;
}

/** El evento como lo lee el reparto: la audiencia con ids, sin nombres. */
function findTeamBuilderEvent(eventId: string) {
  const row = club.events.find((candidate) => candidate.id === eventId);
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    clubId: CLUB_ID,
    eventType: row.eventType,
    title: row.title,
    status: row.status,
    startsOn: row.startsOn,
    startTime: row.startTime,
    audience:
      row.audience.kind === "club"
        ? { kind: "club" as const }
        : {
            kind: "groups" as const,
            groupIds: row.audience.groups.map((group) => group.id),
          },
  };
}

function signedUrlsOf(paths: readonly string[]): ReadonlyMap<string, string> {
  return new Map(paths.map((path) => [path, `${SIGNED_URL_PREFIX}${path}`]));
}

function isOlderThan(row: NewsFeedRow, query: NewsFeedQuery): boolean {
  if (query.after === null) {
    return true;
  }
  return row.publishedAt === query.after.publishedAt
    ? row.id < query.after.id
    : row.publishedAt < query.after.publishedAt;
}

function findFeedPage(query: NewsFeedQuery): readonly NewsFeedRow[] {
  failIf("feed");
  return club.posts
    .filter((row) => isOlderThan(row, query))
    .sort((first, second) =>
      first.publishedAt === second.publishedAt
        ? second.id.localeCompare(first.id)
        : second.publishedAt.localeCompare(first.publishedAt),
    )
    .slice(0, query.limit);
}

function gateways(): DashboardGateways {
  const members = {
    findRoleRequestMember: async () => ({
      clubId: CLUB_ID,
      fullName: "Alba Ferrer",
      role: club.role,
    }),
  };
  const memberGroups = {
    listGroupsOf: async () =>
      club.groupIds.map((id) => ({ id, name: "Grupo" })),
  };
  return {
    members,
    clubRate: {
      members,
      clubRate: {
        findClubAttendanceRate: async (_clubId, window) => {
          failIf("clubRate");
          clubRateWindows.push(window);
          return club.clubRatesBySince.get(window.since) ?? club.clubRate;
        },
      },
    },
    ownAttendance: {
      members,
      attendance: {
        findMemberAttendance: async (_clubId, userIds) => {
          failIf("attendance");
          return new Map(userIds.map((id) => [id, club.ownAttendance]));
        },
      },
    },
    agenda: {
      members,
      memberGroups,
      agenda: {
        findAgendaPage: async (query) => findAgendaPage(query),
        findEvent: async ({ eventId }) => findEvent(eventId),
        countResponses: async (eventIds) =>
          club.tallies.filter((tally) => eventIds.includes(tally.eventId)),
        listResponders: async () => [],
        summarizeSeries: async () => null,
      },
      eventCovers: { signUrls: async (paths) => signedUrlsOf(paths) },
    },
    news: {
      members,
      memberGroups,
      posts: {
        findClubGroupIds: async () => new Set(),
        findGroupNames: async () => new Map(),
        insertPost: async () => {
          throw new Error("el dashboard no publica");
        },
        findFeedPage: async (query) => findFeedPage(query),
        findPost: async () => null,
        deletePost: async () => undefined,
        updatePost: async () => ({ kind: "updated" }),
        setPostStatus: async () => undefined,
        findPinnedFeedRow: async () => club.pinned,
        pinPost: async () => {
          throw new Error("el dashboard no fija");
        },
        unpinPost: async () => {
          throw new Error("el dashboard no desfija");
        },
      },
      covers: {
        ...fakeCoverlessGateway(),
        signUrls: async (paths) =>
          signedUrlsOf(
            paths.filter((path) =>
              [...club.newsCoverIds].some((id) => path.includes(id)),
            ),
          ),
      },
      inlineImages: fakeImagelessGateway(),
      authorPhotos: fakeAuthorPhotosGateway(),
      audit: { insertAuditLogRow: async () => ({ error: null }) },
    },
    roster: {
      countActiveMembers: async ({ joinedSince }) => {
        failIf("roster");
        joinedSinceAsked.push(joinedSince);
        return club.activeMembers;
      },
      findNewsSeenAt: async () => {
        failIf("roster");
        failIf("newsSeen");
        return club.newsSeenAt;
      },
      findOwnContact: async () => {
        failIf("contact");
        return club.contact;
      },
    },
    membership: {
      findByUserId: async () => club.membership,
    },
    myTeam: {
      members,
      memberGroups,
      teams: {
        findEvent: async ({ eventId }) => findTeamBuilderEvent(eventId),
        findSplit: async (eventId) => {
          failIf("teams");
          return club.splits.get(eventId) ?? null;
        },
        findPlayers: async ({ userIds }) =>
          club.players.filter((player) => userIds.includes(player.userId)),
      },
      positions: { findClubPositions: async () => SEEDED_POSITIONS },
    },
    seasonAttendance: {
      findSeasonStartsOn: async () => {
        failIf("season");
        return club.seasonStartsOn;
      },
      findMemberSessions: async ({ userId, since, until, recent }) => {
        failIf("season");
        sessionQueries.push({ userId, since, until, recent });
        return memberSessionsIn({ since, until, recent });
      },
    },
    administration: {
      members: { ...members, findClubMembers: async () => [] },
      requests: {
        findPendingRequests: async () => {
          failIf("roleRequests");
          return club.pendingRequests;
        },
      },
    },
    attendanceSessions: {
      members,
      sessions: {
        findRecentTrainings: async ({ since, until }) => {
          failIf("sessions");
          return club.recentTrainings.filter(
            ({ startsAt }) => startsAt >= since && startsAt <= until,
          );
        },
      },
    },
    unanswered: {
      countUnanswered: async ({ eventId }) => {
        failIf("unanswered");
        return club.unanswered.get(eventId) ?? 0;
      },
    },
    failures: {
      report: (source, error) => {
        reported.push({ source, error });
      },
    },
  };
}

/** Lo que hace `member_attendance_sessions` (`0076`): las de la temporada
 * hasta hoy y, además, las `recent` más recientes. */
function memberSessionsIn(
  query: Omit<MemberSessionsQuery, "clubId" | "userId">,
): readonly AttendedSession[] {
  const upToToday = club.ownSessions.filter(
    (session) => session.startsOn <= query.until,
  );
  return upToToday.filter(
    (session, index) =>
      session.startsOn >= query.since ||
      index >= upToToday.length - query.recent,
  );
}

function membershipWith(status: MembershipStatus): MembershipRecord {
  return {
    userId: CALLER_ID,
    clubId: CLUB_ID,
    plan: "Full",
    status,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    trialEnd: null,
    card: null,
    waiver: null,
    scheduledChange: null,
  };
}

/** El inicio de un socio al día, que es el de casi todos los tests. */
async function dashboard(now: Date = NOW): Promise<MemberDashboard> {
  const result = await readDashboard(gateways(), {
    callerId: CALLER_ID,
    now,
  });
  if (result.kind !== "member") {
    throw new Error(`Se esperaba el inicio de socio y llegó ${result.kind}`);
  }
  return result;
}

/** El inicio de quien no tiene la membresía al día (#453). */
async function restrictedDashboard(): Promise<RestrictedDashboard> {
  const result = await readDashboard(gateways(), {
    callerId: CALLER_ID,
    now: NOW,
  });
  if (result.kind !== "restricted") {
    throw new Error(`Se esperaba el inicio reducido y llegó ${result.kind}`);
  }
  return result;
}

beforeEach(() => {
  clubRateWindows.length = 0;
  joinedSinceAsked.length = 0;
  sessionQueries.length = 0;
  reported.length = 0;
  club = {
    role: "Player",
    groupIds: [],
    events: [],
    posts: [],
    pinned: null,
    clubRate: { kind: "rate", percent: 86, records: 42 },
    clubRatesBySince: new Map(),
    ownAttendance: { kind: "rate", percent: 75, sessions: 6 },
    activeMembers: { active: 1, joinedRecently: 0 },
    newsSeenAt: null,
    contact: { phone: "0412 345 678", emergencyContact: SISTER },
    membership: membershipWith("active"),
    tallies: [],
    splits: new Map(),
    players: [],
    newsCoverIds: new Set(),
    seasonStartsOn: null,
    ownSessions: [],
    pendingRequests: [],
    recentTrainings: [],
    unanswered: new Map(),
    failing: new Set(),
  };
});

describe("la primera tesela", () => {
  it.each<Role>(["Admin", "Coach"])(
    "a un %s le da la tasa del club de los últimos 30 días",
    async (role) => {
      club.role = role;

      const result = await dashboard();

      expect(result.tiles.attendance).toEqual({
        kind: "club_rate",
        rate: { kind: "rate", percent: 86, records: 42 },
      });
      expect(clubRateWindows).toContainEqual({
        since: "2026-09-01",
        until: TODAY_IN_CLUB,
      });
    },
  );

  it("dice sin datos a un Coach cuando no hay hojas en el periodo", async () => {
    club.role = "Coach";
    club.clubRate = { kind: "no_data" };

    const result = await dashboard();

    expect(result.tiles.attendance).toEqual({
      kind: "club_rate",
      rate: { kind: "no_data" },
    });
  });

  it.each<Role>(["Committee", "Player"])(
    "a un %s le da su propia asistencia",
    async (role) => {
      club.role = role;

      const result = await dashboard();

      expect(result.tiles.attendance).toEqual({
        kind: "own_attendance",
        attendance: { kind: "rate", percent: 75, sessions: 6 },
      });
    },
  );

  it("a un Player no le pide la tasa del club", async () => {
    await dashboard();

    expect(clubRateWindows).toEqual([]);
  });

  it("dice sin datos a un Player sin sesiones elegibles", async () => {
    club.ownAttendance = { kind: "no_data" };

    const result = await dashboard();

    expect(result.tiles.attendance).toEqual({
      kind: "own_attendance",
      attendance: { kind: "no_data" },
    });
  });
});

describe("socios activos", () => {
  it("cuenta las altas desde hace 30 días según el día del club", async () => {
    club.activeMembers = { active: 24, joinedRecently: 3 };

    const result = await dashboard();

    expect(result.tiles.members).toEqual({
      kind: "members",
      active: 24,
      joinedRecently: 3,
    });
    expect(joinedSinceAsked).toEqual(["2026-09-01"]);
  });

  it("toma el día de Melbourne aunque en UTC siga siendo ayer", async () => {
    // 29 de septiembre en UTC, ya 30 en Melbourne.
    const lateUtc = new Date("2026-09-29T15:00:00.000Z");

    await readDashboard(gateways(), { callerId: CALLER_ID, now: lateUtc });

    expect(joinedSinceAsked).toEqual(["2026-09-01"]);
  });

  it("sirve cero altas sin inventar ninguna", async () => {
    club.activeMembers = { active: 12, joinedRecently: 0 };

    const result = await dashboard();

    expect(result.tiles.members).toEqual({
      kind: "members",
      active: 12,
      joinedRecently: 0,
    });
  });
});

describe("el próximo entrenamiento", () => {
  it("es el primero que empieza después de ahora en la hora del club", async () => {
    const started = event({ startsOn: TODAY_IN_CLUB, startTime: "17:30" });
    const next = event({
      startsOn: TODAY_IN_CLUB,
      startTime: "19:00",
      title: "Entrenamiento de la noche",
    });
    const later = event({ startsOn: "2026-10-02", startTime: "19:00" });
    club.events = [later, started, { ...next, myResponse: "yes" }];

    const result = await dashboard();

    expect(result.tiles.nextTraining).toEqual({
      kind: "training",
      training: {
        id: next.id,
        title: "Entrenamiento de la noche",
        startsOn: TODAY_IN_CLUB,
        startTime: "19:00",
        location: "MSAC",
        goingCount: 0,
        maybeCount: 0,
        myResponse: "yes",
      },
    });
  });

  it("no cuenta un entrenamiento cancelado", async () => {
    const cancelled = event({
      startsOn: "2026-10-01",
      startTime: "19:00",
      status: "cancelled",
    });
    const next = event({ startsOn: "2026-10-03", startTime: "09:00" });
    club.events = [cancelled, next];

    const result = await dashboard();

    expect(result.tiles.nextTraining).toMatchObject({
      kind: "training",
      training: { id: next.id },
    });
  });

  it("salta los eventos que no son entrenamientos", async () => {
    const social = event({
      startsOn: "2026-10-01",
      startTime: "19:00",
      eventType: "social",
    });
    const training = event({ startsOn: "2026-10-04", startTime: "10:00" });
    club.events = [social, training];

    const result = await dashboard();

    expect(result.tiles.nextTraining).toMatchObject({
      training: { id: training.id },
    });
  });

  it("no hay ninguno para quien no está en la audiencia", async () => {
    club.events = [
      event({
        startsOn: "2026-10-01",
        startTime: "19:00",
        groupIds: [COACHES_GROUP],
      }),
    ];

    const result = await dashboard();

    expect(result.tiles.nextTraining).toEqual({ kind: "none" });
  });

  it("a un Admin no le da uno que no va dirigido a él", async () => {
    club.role = "Admin";
    club.events = [
      event({
        startsOn: "2026-10-01",
        startTime: "19:00",
        groupIds: [COACHES_GROUP],
      }),
    ];

    const result = await dashboard();

    expect(result.tiles.nextTraining).toEqual({ kind: "none" });
    expect(result.upcomingEvents).toEqual({ kind: "events", events: [] });
  });
});

describe("los próximos eventos", () => {
  it("son los tres primeros de su audiencia, de cualquier tipo, sin cancelados ni empezados", async () => {
    const started = event({ startsOn: TODAY_IN_CLUB, startTime: "07:00" });
    const cancelled = event({
      startsOn: "2026-10-01",
      startTime: "08:00",
      status: "cancelled",
    });
    const meeting = event({
      startsOn: "2026-10-01",
      startTime: "19:00",
      eventType: "meeting",
    });
    const training = event({ startsOn: "2026-10-02", startTime: "19:00" });
    const competition = event({
      startsOn: "2026-10-03",
      startTime: "09:00",
      eventType: "competition",
    });
    const fourth = event({ startsOn: "2026-10-05", startTime: "19:00" });
    club.events = [fourth, competition, training, meeting, cancelled, started];

    const result = await dashboard();

    expect(result.upcomingEvents).toMatchObject({
      kind: "events",
      events: [
        { id: meeting.id, eventType: "meeting", inAudience: true },
        { id: training.id, eventType: "training" },
        { id: competition.id, eventType: "competition" },
      ],
    });
  });
});

describe("las últimas noticias", () => {
  it("son las tres más recientes que puede leer, sin las retiradas", async () => {
    const newest = post({
      publishedAt: "2026-09-29T00:00:00.000Z",
      category: "announcement",
      title: "Cambio de piscina",
    });
    const withdrawn = post({
      publishedAt: "2026-09-28T00:00:00.000Z",
      status: "withdrawn",
    });
    const second = post({ publishedAt: "2026-09-27T00:00:00.000Z" });
    const third = post({
      publishedAt: "2026-09-20T00:00:00.000Z",
      category: "document",
    });
    const fourth = post({ publishedAt: "2026-09-10T00:00:00.000Z" });
    club.posts = [fourth, third, second, withdrawn, newest];

    const result = await dashboard();

    expect(result.latestNews).toEqual({
      kind: "news",
      posts: [
        {
          id: newest.id,
          category: "announcement",
          title: "Cambio de piscina",
          publishedAt: "2026-09-29T00:00:00.000Z",
          coverUrl: null,
          excerpt: "Ganamos los tres partidos.",
          isPinned: false,
          isUnread: true,
        },
        {
          id: second.id,
          category: "news",
          title: "Crónica del torneo",
          publishedAt: "2026-09-27T00:00:00.000Z",
          coverUrl: null,
          excerpt: "Ganamos los tres partidos.",
          isPinned: false,
          isUnread: true,
        },
        {
          id: third.id,
          category: "document",
          title: "Crónica del torneo",
          publishedAt: "2026-09-20T00:00:00.000Z",
          coverUrl: null,
          excerpt: "Ganamos los tres partidos.",
          isPinned: false,
          isUnread: true,
        },
      ],
    });
  });
});

describe("la fijada en el inicio", () => {
  function pinnedPost(
    overrides: Parameters<typeof post>[0],
  ): NewsPinnedFeedRow {
    return { ...post(overrides), pinnedUntil: null };
  }

  it("va primera, marcada, y detrás las más nuevas (#745)", async () => {
    const newest = post({ publishedAt: "2026-09-29T00:00:00.000Z" });
    const pinned = pinnedPost({ publishedAt: "2026-09-20T00:00:00.000Z" });
    const older = post({ publishedAt: "2026-09-27T00:00:00.000Z" });
    const oldest = post({ publishedAt: "2026-09-26T00:00:00.000Z" });
    club.posts = [oldest, older, newest];
    club.pinned = pinned;

    const result = await dashboard();

    expect(result.latestNews).toMatchObject({
      kind: "news",
      posts: [
        { id: pinned.id, isPinned: true },
        { id: newest.id, isPinned: false },
        { id: older.id, isPinned: false },
      ],
    });
  });

  it("cuenta la fijada sin leer una sola vez, aunque sea más antigua que la primera página", async () => {
    club.newsSeenAt = "2026-09-01T00:00:00.000Z";
    // Del 28 al 4 de septiembre: más de una página, todas sin leer.
    club.posts = Array.from({ length: 25 }, (_, index) =>
      post({
        publishedAt: `2026-09-${String(28 - index).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    club.pinned = pinnedPost({
      publishedAt: "2026-09-02T00:00:00.000Z",
      category: "announcement",
    });

    const result = await dashboard();

    expect(result.tiles.unreadNews).toEqual({
      kind: "unread",
      count: club.posts.length + 1,
      announcements: 1,
    });
  });
});

describe("sin leer", () => {
  it("cuenta las publicadas después de la marca de visita", async () => {
    club.newsSeenAt = "2026-09-25T00:00:00.000Z";
    club.posts = [
      post({ publishedAt: "2026-09-29T00:00:00.000Z" }),
      post({ publishedAt: "2026-09-26T00:00:00.000Z" }),
      post({ publishedAt: "2026-09-24T00:00:00.000Z" }),
    ];

    const result = await dashboard();

    expect(result.tiles.unreadNews).toEqual({
      kind: "unread",
      count: 2,
      announcements: 0,
    });
  });

  it("sin marca, cuenta las de los últimos 30 días", async () => {
    club.posts = [
      post({ publishedAt: "2026-09-29T00:00:00.000Z" }),
      post({ publishedAt: "2026-09-01T00:00:00.000Z" }),
      post({ publishedAt: "2026-08-30T00:00:00.000Z" }),
    ];

    const result = await dashboard();

    expect(result.tiles.unreadNews).toEqual({
      kind: "unread",
      count: 2,
      announcements: 0,
    });
  });

  it("dice cuántas de ellas son anuncios", async () => {
    club.posts = [
      post({ publishedAt: "2026-09-29T00:00:00.000Z" }),
      post({
        publishedAt: "2026-09-28T00:00:00.000Z",
        category: "announcement",
      }),
      post({
        publishedAt: "2026-09-27T00:00:00.000Z",
        category: "announcement",
      }),
    ];

    const result = await dashboard();

    expect(result.tiles.unreadNews).toEqual({
      kind: "unread",
      count: 3,
      announcements: 2,
    });
  });

  it("no cuenta las retiradas", async () => {
    club.posts = [
      post({ publishedAt: "2026-09-29T00:00:00.000Z", status: "withdrawn" }),
      post({ publishedAt: "2026-09-28T00:00:00.000Z" }),
    ];

    const result = await dashboard();

    expect(result.tiles.unreadNews).toEqual({
      kind: "unread",
      count: 1,
      announcements: 0,
    });
  });

  it("sigue contando más allá de la primera página del feed", async () => {
    club.posts = Array.from({ length: 45 }, (_, index) =>
      post({
        publishedAt: new Date(
          Date.parse("2026-09-29T00:00:00.000Z") - index * 3_600_000,
        ).toISOString(),
      }),
    );

    const result = await dashboard();

    expect(result.tiles.unreadNews).toEqual({
      kind: "unread",
      count: 45,
      announcements: 0,
    });
  });
});

describe("fuentes caídas", () => {
  it("sin la marca de visita, sólo cae la cuenta sin leer", async () => {
    club.failing.add("newsSeen");
    club.posts = [post({ publishedAt: "2026-09-29T00:00:00.000Z" })];

    const result = await dashboard();

    expect(result.tiles.unreadNews).toEqual({ kind: "unavailable" });
    expect(result.latestNews).toMatchObject({
      kind: "news",
      posts: [{ title: "Crónica del torneo" }],
    });
    expect(reported.map((failure) => failure.source)).toEqual(["news_seen"]);
  });

  it("la tasa del club llega no disponible y el resto se sirve", async () => {
    club.role = "Admin";
    club.failing.add("clubRate");
    club.posts = [post({ publishedAt: "2026-09-29T00:00:00.000Z" })];

    const result = await dashboard();

    expect(result.tiles.attendance).toEqual({ kind: "unavailable" });
    expect(result.tiles.members).toMatchObject({ kind: "members" });
    expect(result.tiles.unreadNews).toMatchObject({ kind: "unread", count: 1 });
    expect(result.latestNews).toMatchObject({ kind: "news" });
  });

  it("deja el fallo en el log con su causa", async () => {
    club.role = "Coach";
    club.failing.add("clubRate");

    await dashboard();

    // La tesela y los números del club leen la tasa a la vez.
    expect(reported).toHaveLength(2);
    expect(reported).toEqual(
      expect.arrayContaining([
        {
          source: "attendance",
          error: new Error("la base no contesta: clubRate"),
        },
        {
          source: "club_attendance",
          error: new Error("la base no contesta: clubRate"),
        },
      ]),
    );
  });

  it("sin agenda, el entrenamiento y los eventos no están disponibles", async () => {
    club.failing.add("agenda");

    const result = await dashboard();

    expect(result.tiles.nextTraining).toEqual({ kind: "unavailable" });
    expect(result.upcomingEvents).toEqual({ kind: "unavailable" });
    expect(result.tiles.attendance).toMatchObject({ kind: "own_attendance" });
    expect(reported.map((failure) => failure.source)).toEqual(["agenda"]);
  });

  it("sin feed, las noticias y la cuenta sin leer no están disponibles", async () => {
    club.failing.add("feed");

    const result = await dashboard();

    expect(result.tiles.unreadNews).toEqual({ kind: "unavailable" });
    expect(result.latestNews).toEqual({ kind: "unavailable" });
    expect(result.tiles.nextTraining).toEqual({ kind: "none" });
  });

  it("sin la fila de socios, sólo caen sus teselas", async () => {
    club.failing.add("roster");

    const result = await dashboard();

    expect(result.tiles.members).toEqual({ kind: "unavailable" });
    expect(result.tiles.unreadNews).toEqual({ kind: "unavailable" });
    expect(result.latestNews).toEqual({ kind: "news", posts: [] });
  });
});

describe("vacío", () => {
  it("un club recién creado trae cada parte en su variante vacía", async () => {
    club.ownAttendance = { kind: "no_data" };

    const result = await dashboard();

    expect(result).toEqual({
      kind: "member",
      column: "player",
      viewer: { firstName: "Alba" },
      me: { attendance: null },
      tiles: {
        attendance: { kind: "own_attendance", attendance: { kind: "no_data" } },
        members: { kind: "members", active: 1, joinedRecently: 0 },
        nextTraining: { kind: "none" },
        unreadNews: { kind: "unread", count: 0, announcements: 0 },
      },
      upcomingEvents: { kind: "events", events: [] },
      latestNews: { kind: "news", posts: [] },
      contactReminder: { kind: "reminder", reminder: "none" },
      nextUp: { kind: "none" },
      week: { kind: "week", events: [] },
      membership: { status: "active", plan: "Full", renewsOn: null },
    });
    expect(reported).toEqual([]);
  });
});

describe("quien mira", () => {
  it("sirve el nombre de pila para el saludo", async () => {
    const result = await dashboard();

    expect(result.viewer).toEqual({ firstName: "Alba" });
  });
});

describe("el aviso del contacto (#498)", () => {
  it("pide los dos a quien no tiene ni teléfono ni contacto", async () => {
    club.contact = { phone: null, emergencyContact: null };

    const result = await dashboard();

    expect(result.contactReminder).toEqual({
      kind: "reminder",
      reminder: "both",
    });
  });

  it("pide el teléfono a quien ya tiene contacto", async () => {
    club.contact = { phone: null, emergencyContact: SISTER };

    const result = await dashboard();

    expect(result.contactReminder).toEqual({
      kind: "reminder",
      reminder: "phone",
    });
  });

  it("también avisa en el inicio reducido: el aviso no depende de pagar", async () => {
    club.membership = membershipWith("pending");
    club.contact = { phone: "0412 345 678", emergencyContact: null };

    const result = await restrictedDashboard();

    expect(result.contactReminder).toEqual({
      kind: "reminder",
      reminder: "emergency_contact",
    });
  });

  it("sin la lectura del contacto llega no disponible, con el fallo en el log, y el resto se sirve", async () => {
    club.failing.add("contact");

    const result = await dashboard();

    expect(result.contactReminder).toEqual({ kind: "unavailable" });
    expect(result.tiles.members).toEqual({
      kind: "members",
      active: 1,
      joinedRecently: 0,
    });
    expect(reported.map(({ source }) => source)).toEqual(["contact"]);
  });
});

describe("quien no tiene la membresía al día (#453)", () => {
  it.each(["pending", "past_due", "cancelled"] as const)(
    "a una membresía %s le da el saludo, el motivo y el próximo entrenamiento",
    async (status) => {
      club.membership = membershipWith(status);
      club.events = [
        event({ startsOn: "2026-10-01", startTime: "19:00", title: "Piscina" }),
      ];

      const result = await restrictedDashboard();

      expect(result.viewer).toEqual({ firstName: "Alba" });
      expect(result.block).toBe(status);
      expect(result.nextTraining).toMatchObject({
        kind: "training",
        training: { title: "Piscina" },
      });
    },
  );

  it("no le da teselas de club ni la lista de próximos", async () => {
    club.membership = membershipWith("pending");
    club.posts = [post({ publishedAt: "2026-09-29T08:00:00.000Z" })];

    const result = await restrictedDashboard();

    expect(Object.keys(result).sort()).toEqual([
      "block",
      "contactReminder",
      "kind",
      "latestNews",
      "me",
      "membership",
      "nextTraining",
      "nextUp",
      "viewer",
      "week",
    ]);
  });

  it("cuenta como pendiente a quien no tiene membresía", async () => {
    club.membership = null;

    const result = await restrictedDashboard();

    expect(result.block).toBe("pending");
  });

  it("dice que no hay entrenamiento cuando no hay ninguno a la vista", async () => {
    club.membership = membershipWith("past_due");

    const result = await restrictedDashboard();

    expect(result.nextTraining).toEqual({ kind: "none" });
  });

  it("vale lo mismo para el personal: un Admin sin pagar ve el inicio reducido", async () => {
    club.role = "Admin";
    club.membership = membershipWith("cancelled");

    const result = await restrictedDashboard();

    expect(result.block).toBe("cancelled");
  });

  it("a quien está al día le da el inicio de siempre", async () => {
    club.membership = membershipWith("trialing");

    const result = await dashboard();

    expect(result.kind).toBe("member");
  });
});

/** El próximo evento de un inicio, cuando lo hay. */
function nextUpEventOf(result: Dashboard): DashboardNextUpEvent {
  if (result.nextUp.kind !== "event") {
    throw new Error(`Se esperaba un evento y llegó ${result.nextUp.kind}`);
  }
  return result.nextUp;
}

describe("el próximo evento (#745)", () => {
  it("es el primero que ve, de cualquier tipo, con lo que pinta la tarjeta", async () => {
    const coverId = "c0c0c0c0-0000-4000-8000-000000000001";
    const social = event({
      startsOn: "2026-10-02",
      startTime: "19:00",
      endTime: "21:00",
      eventType: "social",
      title: "Cena del club",
      coverUploadId: coverId,
      myResponse: "yes",
    });
    club.events = [
      event({ startsOn: "2026-10-03", startTime: "19:00" }),
      social,
    ];
    club.tallies = [{ eventId: social.id, goingCount: 4, maybeCount: 1 }];

    const result = await dashboard();

    expect(result.nextUp).toEqual({
      kind: "event",
      id: social.id,
      title: "Cena del club",
      eventType: "social",
      startsOn: "2026-10-02",
      endsOn: null,
      startTime: "19:00",
      endTime: "21:00",
      location: "MSAC",
      place: null,
      coverUrl: `${SIGNED_URL_PREFIX}${CLUB_ID}/${coverId}-large.webp`,
      audience: { kind: "club" },
      goingCount: 4,
      maybeCount: 1,
      myResponse: "yes",
      myTeam: null,
    });
  });

  it("dice que no hay ninguno cuando no hay nada a la vista", async () => {
    const result = await dashboard();

    expect(result.nextUp).toEqual({ kind: "none" });
  });

  it("no cuenta un evento cancelado", async () => {
    club.events = [
      event({
        startsOn: "2026-10-01",
        startTime: "19:00",
        status: "cancelled",
      }),
    ];

    const result = await dashboard();

    expect(result.nextUp).toEqual({ kind: "none" });
  });

  it("a un Admin no le da uno que no va dirigido a él", async () => {
    club.role = "Admin";
    club.events = [
      event({
        startsOn: "2026-10-01",
        startTime: "19:00",
        groupIds: [COACHES_GROUP],
      }),
    ];

    const result = await dashboard();

    expect(result.nextUp).toEqual({ kind: "none" });
  });

  it("un evento que ya empezó sigue siendo el próximo hasta su hora de fin", async () => {
    club.events = [
      event({
        startsOn: TODAY_IN_CLUB,
        startTime: "16:00",
        endTime: "17:30",
        title: "Ya terminó",
      }),
      event({
        startsOn: TODAY_IN_CLUB,
        startTime: "17:00",
        endTime: "19:00",
        title: "En curso",
      }),
    ];

    const result = await dashboard();

    expect(nextUpEventOf(result).title).toBe("En curso");
  });

  it("sin hora de fin, sigue siendo el próximo hasta el final del día", async () => {
    club.events = [
      event({ startsOn: TODAY_IN_CLUB, startTime: "10:00", title: "Hoy" }),
    ];

    const result = await dashboard();

    expect(nextUpEventOf(result).title).toBe("Hoy");
  });

  it("un evento de varios días que empezó ayer sigue siendo el próximo", async () => {
    club.events = [
      event({
        startsOn: "2026-09-29",
        startTime: "09:00",
        endsOn: "2026-10-01",
        endTime: "17:00",
        eventType: "competition",
        title: "Torneo",
      }),
      event({ startsOn: "2026-10-01", startTime: "19:00" }),
    ];

    const result = await dashboard();

    expect(nextUpEventOf(result).title).toBe("Torneo");
  });

  it("uno de ayer sin hora de fin ya no cuenta", async () => {
    club.events = [event({ startsOn: "2026-09-29", startTime: "19:00" })];

    const result = await dashboard();

    expect(result.nextUp).toEqual({ kind: "none" });
  });
});

describe("mi equipo en el próximo evento (#745)", () => {
  const PUBLISHED_AT = new Date("2026-09-29T00:00:00.000Z");

  function scrimmage(): EventRow {
    const row = event({
      startsOn: "2026-10-01",
      startTime: "19:00",
      eventType: "competition",
    });
    club.events = [row];
    return row;
  }

  function splitWith(
    assignments: StoredTeamSplit["assignments"],
    publishedAt: Date | null = PUBLISHED_AT,
  ): StoredTeamSplit {
    return {
      teams: DEFAULT_TEAM_LABELS,
      mode: "auto",
      publishedAt,
      assignments,
    };
  }

  function playerWith(positionId: string | null): PlayerRecord {
    return {
      userId: CALLER_ID,
      fullName: "Alba Ferrer",
      positionId,
      coverage: null,
      ratings: null,
      membershipCurrent: true,
    };
  }

  it("da a un Player del reparto publicado su equipo, su color y su posición", async () => {
    const row = scrimmage();
    club.players = [playerWith(GOALKEEPER.id)];
    club.splits.set(row.id, splitWith([{ userId: CALLER_ID, team: "b" }]));

    const result = await dashboard();

    expect(nextUpEventOf(result).myTeam).toEqual({
      name: DEFAULT_TEAM_LABELS.b.name,
      color: DEFAULT_TEAM_LABELS.b.color,
      position: { id: GOALKEEPER.id, names: GOALKEEPER.names },
    });
  });

  it("deja la posición en null si no tiene", async () => {
    const row = scrimmage();
    club.players = [playerWith(null)];
    club.splits.set(row.id, splitWith([{ userId: CALLER_ID, team: "a" }]));

    const result = await dashboard();

    expect(nextUpEventOf(result).myTeam).toEqual({
      name: DEFAULT_TEAM_LABELS.a.name,
      color: DEFAULT_TEAM_LABELS.a.color,
      position: null,
    });
  });

  it("es null con el reparto en borrador", async () => {
    const row = scrimmage();
    club.players = [playerWith(GOALKEEPER.id)];
    club.splits.set(
      row.id,
      splitWith([{ userId: CALLER_ID, team: "b" }], null),
    );

    const result = await dashboard();

    expect(nextUpEventOf(result).myTeam).toBeNull();
  });

  it("es null sin reparto", async () => {
    scrimmage();

    const result = await dashboard();

    expect(nextUpEventOf(result).myTeam).toBeNull();
  });

  it("es null para un Player que no está en el reparto", async () => {
    const row = scrimmage();
    club.splits.set(
      row.id,
      splitWith([
        { userId: "11111111-0000-4000-8000-000000000001", team: "a" },
      ]),
    );

    const result = await dashboard();

    expect(nextUpEventOf(result).myTeam).toBeNull();
  });

  it("es null para un socio restringido aunque esté en el reparto", async () => {
    const row = scrimmage();
    club.membership = membershipWith("past_due");
    club.players = [playerWith(GOALKEEPER.id)];
    club.splits.set(row.id, splitWith([{ userId: CALLER_ID, team: "b" }]));

    const result = await restrictedDashboard();

    expect(nextUpEventOf(result).myTeam).toBeNull();
  });

  it.each(["Admin", "Coach"] as const)(
    "a un %s le dice none sin reparto",
    async (role) => {
      club.role = role;
      scrimmage();

      const result = await dashboard();

      expect(nextUpEventOf(result)).toMatchObject({ teamsStatus: "none" });
    },
  );

  it.each(["Admin", "Coach"] as const)(
    "a un %s le dice draft con el reparto guardado sin publicar",
    async (role) => {
      club.role = role;
      const row = scrimmage();
      club.splits.set(row.id, splitWith([], null));

      const result = await dashboard();

      expect(nextUpEventOf(result)).toMatchObject({ teamsStatus: "draft" });
    },
  );

  it.each(["Admin", "Coach"] as const)(
    "a un %s le dice published con el reparto publicado",
    async (role) => {
      club.role = role;
      const row = scrimmage();
      club.splits.set(row.id, splitWith([]));

      const result = await dashboard();

      expect(nextUpEventOf(result)).toMatchObject({
        teamsStatus: "published",
      });
    },
  );

  it.each<Role>(["Committee", "Player"])(
    "a un %s no le manda el estado del reparto",
    async (role) => {
      club.role = role;
      const row = scrimmage();
      club.splits.set(row.id, splitWith([], null));

      const result = await dashboard();

      expect(nextUpEventOf(result)).not.toHaveProperty("teamsStatus");
    },
  );
});

describe("la semana (#745)", () => {
  it("trae los eventos con algún día de hoy a hoy + 6, por inicio, con lo que pinta la franja", async () => {
    const tournament = event({
      startsOn: "2026-09-28",
      startTime: "09:00",
      endsOn: "2026-10-01",
      endTime: "17:00",
      eventType: "competition",
      title: "Torneo",
    });
    const earlierToday = event({
      startsOn: TODAY_IN_CLUB,
      startTime: "07:00",
      endTime: "08:00",
      title: "Temprano",
      myResponse: "maybe",
    });
    const lastDay = event({
      startsOn: "2026-10-06",
      startTime: "19:00",
      title: "Último día",
    });
    club.events = [
      lastDay,
      event({ startsOn: "2026-10-07", startTime: "19:00", title: "Fuera" }),
      event({
        startsOn: "2026-10-02",
        startTime: "19:00",
        status: "cancelled",
        title: "Cancelado",
      }),
      event({ startsOn: "2026-09-29", startTime: "19:00", title: "Ayer" }),
      earlierToday,
      tournament,
    ];

    const result = await dashboard();

    expect(result.week).toEqual({
      kind: "week",
      events: [
        {
          id: tournament.id,
          title: "Torneo",
          eventType: "competition",
          startsOn: "2026-09-28",
          endsOn: "2026-10-01",
          startTime: "09:00",
          endTime: "17:00",
          location: "MSAC",
          myResponse: null,
        },
        {
          id: earlierToday.id,
          title: "Temprano",
          eventType: "training",
          startsOn: TODAY_IN_CLUB,
          endsOn: null,
          startTime: "07:00",
          endTime: "08:00",
          location: "MSAC",
          myResponse: "maybe",
        },
        {
          id: lastDay.id,
          title: "Último día",
          eventType: "training",
          startsOn: "2026-10-06",
          endsOn: null,
          startTime: "19:00",
          endTime: null,
          location: "MSAC",
          myResponse: null,
        },
      ],
    });
  });

  it("a un Player le enseña una reunión dirigida a todo el club (D5)", async () => {
    club.events = [
      event({
        startsOn: "2026-10-02",
        startTime: "19:00",
        eventType: "meeting",
        title: "Asamblea",
      }),
    ];

    const result = await dashboard();

    expect(result.week).toMatchObject({
      kind: "week",
      events: [{ title: "Asamblea", eventType: "meeting" }],
    });
  });

  it("no trae lo que no va dirigido a quien mira", async () => {
    club.role = "Admin";
    club.events = [
      event({
        startsOn: "2026-10-02",
        startTime: "19:00",
        groupIds: [COACHES_GROUP],
      }),
    ];

    const result = await dashboard();

    expect(result.week).toEqual({ kind: "week", events: [] });
  });

  it("también le llega al socio restringido", async () => {
    club.membership = membershipWith("cancelled");
    club.events = [
      event({ startsOn: "2026-10-02", startTime: "19:00", title: "Piscina" }),
    ];

    const result = await restrictedDashboard();

    expect(result.week).toMatchObject({
      kind: "week",
      events: [{ title: "Piscina" }],
    });
  });
});

describe("la membresía en el inicio (#745)", () => {
  it("a un socio al día le da el plan y el día de Melbourne en que renueva", async () => {
    club.membership = {
      ...membershipWith("active"),
      // El 16 a la 01:00 en Melbourne (AEDT, UTC+11).
      currentPeriodEnd: new Date("2026-10-15T14:00:00.000Z"),
    };

    const result = await dashboard();

    expect(result.membership).toEqual({
      status: "active",
      plan: "Full",
      renewsOn: "2026-10-16",
    });
  });

  it("deja la renovación en null si no renueva", async () => {
    club.membership = { ...membershipWith("active"), plan: "Casual" };

    const result = await dashboard();

    expect(result.membership).toEqual({
      status: "active",
      plan: "Casual",
      renewsOn: null,
    });
  });

  it("a un socio restringido le da el motivo y el fin del último periodo pagado", async () => {
    club.membership = {
      ...membershipWith("cancelled"),
      currentPeriodEnd: new Date("2026-09-01T02:00:00.000Z"),
    };

    const result = await restrictedDashboard();

    expect(result.membership).toEqual({
      status: "restricted",
      block: "cancelled",
      endedOn: "2026-09-01",
    });
  });

  it("deja la fecha en null a quien no tiene membresía", async () => {
    club.membership = null;

    const result = await restrictedDashboard();

    expect(result.membership).toEqual({
      status: "restricted",
      block: "pending",
      endedOn: null,
    });
  });
});

describe("las noticias del inicio (#745)", () => {
  it("lleva la portada grande de la que la tiene y null en la que no", async () => {
    const coverId = "c0c0c0c0-0000-4000-8000-0000000000aa";
    const withCover = post({
      publishedAt: "2026-09-29T00:00:00.000Z",
      coverUploadId: coverId,
    });
    const withoutCover = post({ publishedAt: "2026-09-28T00:00:00.000Z" });
    club.posts = [withoutCover, withCover];
    club.newsCoverIds = new Set([coverId]);

    const result = await dashboard();

    expect(result.latestNews).toMatchObject({
      kind: "news",
      posts: [
        {
          id: withCover.id,
          coverUrl: `${SIGNED_URL_PREFIX}${CLUB_ID}/covers/${coverId}-large.webp`,
        },
        { id: withoutCover.id, coverUrl: null },
      ],
    });
  });

  it("marca sin leer sólo lo publicado después de la última visita", async () => {
    club.newsSeenAt = "2026-09-28T00:00:00.000Z";
    const fresh = post({ publishedAt: "2026-09-29T00:00:00.000Z" });
    const seen = post({ publishedAt: "2026-09-27T00:00:00.000Z" });
    club.posts = [seen, fresh];

    const result = await dashboard();

    expect(result.latestNews).toMatchObject({
      kind: "news",
      posts: [
        { id: fresh.id, isUnread: true },
        { id: seen.id, isUnread: false },
      ],
    });
  });

  it("al socio restringido le da las mismas tres, sólo con título, categoría y fecha (D2)", async () => {
    club.membership = membershipWith("pending");
    const pinned: NewsPinnedFeedRow = {
      ...post({
        publishedAt: "2026-09-10T00:00:00.000Z",
        category: "announcement",
        title: "Fijada",
        coverUploadId: "c0c0c0c0-0000-4000-8000-0000000000bb",
      }),
      pinnedUntil: null,
    };
    const newest = post({ publishedAt: "2026-09-29T00:00:00.000Z" });
    const second = post({ publishedAt: "2026-09-28T00:00:00.000Z" });
    club.posts = [
      post({ publishedAt: "2026-09-27T00:00:00.000Z" }),
      second,
      newest,
    ];
    club.pinned = pinned;
    club.newsCoverIds = new Set(["c0c0c0c0-0000-4000-8000-0000000000bb"]);

    const result = await restrictedDashboard();

    expect(result.latestNews).toEqual({
      kind: "news",
      posts: [
        {
          id: pinned.id,
          category: "announcement",
          title: "Fijada",
          publishedAt: "2026-09-10T00:00:00.000Z",
        },
        {
          id: newest.id,
          category: "news",
          title: "Crónica del torneo",
          publishedAt: "2026-09-29T00:00:00.000Z",
        },
        {
          id: second.id,
          category: "news",
          title: "Crónica del torneo",
          publishedAt: "2026-09-28T00:00:00.000Z",
        },
      ],
    });
  });
});

describe("bloques nuevos caídos (#745)", () => {
  it("sin agenda, el próximo y la semana no están disponibles y el resto se sirve", async () => {
    club.failing.add("agenda");
    club.posts = [post({ publishedAt: "2026-09-29T00:00:00.000Z" })];

    const result = await dashboard();

    expect(result.nextUp).toEqual({ kind: "unavailable" });
    expect(result.week).toEqual({ kind: "unavailable" });
    expect(result.membership).toMatchObject({ status: "active" });
    expect(result.latestNews).toMatchObject({ kind: "news" });
  });

  it("sin el detalle del evento, sólo cae el próximo", async () => {
    club.failing.add("eventDetail");
    club.events = [event({ startsOn: "2026-10-01", startTime: "19:00" })];

    const result = await dashboard();

    expect(result.nextUp).toEqual({ kind: "unavailable" });
    expect(result.week).toMatchObject({ kind: "week", events: [{}] });
    expect(reported.map((failure) => failure.source)).toEqual(["next_up"]);
  });

  it("sin el reparto, sólo cae el próximo", async () => {
    club.failing.add("teams");
    club.events = [event({ startsOn: "2026-10-01", startTime: "19:00" })];

    const result = await dashboard();

    expect(result.nextUp).toEqual({ kind: "unavailable" });
    expect(result.week).toMatchObject({ kind: "week" });
    expect(reported.map((failure) => failure.source)).toEqual(["next_up"]);
  });

  it("en el inicio reducido, sin feed sólo caen las noticias", async () => {
    club.membership = membershipWith("pending");
    club.failing.add("feed");

    const result = await restrictedDashboard();

    expect(result.latestNews).toEqual({ kind: "unavailable" });
    expect(result.week).toEqual({ kind: "week", events: [] });
    expect(result.nextUp).toEqual({ kind: "none" });
  });

  it("en el inicio reducido, sin agenda caen el próximo y la semana y las noticias llegan", async () => {
    club.membership = membershipWith("pending");
    club.failing.add("agenda");

    const result = await restrictedDashboard();

    expect(result.nextUp).toEqual({ kind: "unavailable" });
    expect(result.week).toEqual({ kind: "unavailable" });
    expect(result.latestNews).toEqual({ kind: "news", posts: [] });
  });
});
function session(
  startsOn: string,
  status: AttendanceStatus = "present",
): AttendedSession {
  return { eventId: uuid(), startsOn, status };
}

describe("mi asistencia de la temporada (#746)", () => {
  it("cuenta presente o tarde sobre las sesiones desde el inicio guardado hasta hoy", async () => {
    club.seasonStartsOn = "2026-08-01";
    club.ownSessions = [
      session("2026-07-29", "absent"),
      session("2026-08-05", "present"),
      session("2026-08-12", "late"),
      session("2026-09-02", "absent"),
    ];

    const result = await dashboard();

    expect(result.me.attendance).toMatchObject({
      percent: 67,
      attended: 2,
      sessions: 3,
    });
    expect(sessionQueries).toEqual([
      {
        userId: CALLER_ID,
        since: "2026-08-01",
        until: TODAY_IN_CLUB,
        recent: 10,
      },
    ]);
  });

  it.each([
    ["sin fecha guardada", null],
    ["con una fecha futura", "2026-11-01"],
  ])("%s cuenta desde el 1 de enero", async (_label, seasonStartsOn) => {
    club.seasonStartsOn = seasonStartsOn;

    await dashboard();

    expect(sessionQueries).toMatchObject([{ since: "2026-01-01" }]);
  });

  it("da las 10 sesiones más recientes, también de antes de la temporada, de la más vieja a la más nueva", async () => {
    club.seasonStartsOn = "2026-09-01";
    const older = Array.from({ length: 9 }, (_, index) =>
      session(`2026-08-${String(index + 10).padStart(2, "0")}`),
    );
    const late = session("2026-09-02", "late");
    const absent = session("2026-09-09", "absent");
    club.ownSessions = [...older, late, absent];

    const result = await dashboard();

    expect(result.me.attendance).toEqual({
      percent: 50,
      attended: 1,
      sessions: 2,
      last10: [...older.slice(1), late, absent],
    });
  });

  it("con menos de 10 sesiones da las que hay", async () => {
    const only = session("2026-09-02", "late");
    club.ownSessions = [only];

    const result = await dashboard();

    expect(result.me.attendance).toEqual({
      percent: 100,
      attended: 1,
      sessions: 1,
      last10: [only],
    });
  });

  it("es null sin sesiones elegibles en la temporada", async () => {
    club.seasonStartsOn = "2026-09-01";
    club.ownSessions = [session("2026-08-20")];

    const result = await dashboard();

    expect(result.me.attendance).toBeNull();
  });

  it("también le llega a un socio restringido", async () => {
    club.membership = membershipWith("past_due");
    club.ownSessions = [session("2026-09-02")];

    const result = await restrictedDashboard();

    expect(result.me.attendance).toMatchObject({ percent: 100, sessions: 1 });
  });

  it("si falla, llega no disponible con el fallo en el log y el resto se sirve", async () => {
    club.failing.add("season");

    const result = await dashboard();

    expect(result.me.attendance).toEqual({ kind: "unavailable" });
    expect(result.membership).toMatchObject({ status: "active" });
    expect(reported.map(({ source }) => source)).toEqual(["season_attendance"]);
  });
});

/** El inicio de quien ve la columna de gestión (D3). */
async function managementDashboard(
  now: Date = NOW,
): Promise<MemberDashboard & ManagementColumn> {
  const result = await dashboard(now);
  if (result.column !== "management") {
    throw new Error(
      `Se esperaba la columna de gestión y llegó ${result.column}`,
    );
  }
  return result;
}

async function todos(): Promise<readonly DashboardTodo[]> {
  const result = await managementDashboard();
  if (!Array.isArray(result.todos)) {
    throw new Error("Se esperaban los pendientes y no llegaron");
  }
  return result.todos;
}

function pendingRequest(
  requesterStatus: PendingRoleRequestRecord["requesterStatus"] = "active",
): PendingRoleRequestRecord {
  return {
    id: uuid(),
    userId: uuid(),
    fullName: "Pablo Player",
    currentRole: "Player",
    requestedRole: "Coach",
    justification: null,
    createdAt: "2026-09-20T00:00:00.000Z",
    requesterStatus,
  };
}

function training(
  startsAt: string,
  statuses: readonly AttendanceStatus[] = [],
  title = "Entrenamiento",
): RecentTraining {
  return { eventId: uuid(), title, startsAt: new Date(startsAt), statuses };
}

function teamSplit(publishedAt: Date | null): StoredTeamSplit {
  return {
    teams: DEFAULT_TEAM_LABELS,
    mode: "auto",
    publishedAt,
    assignments: [],
  };
}

/** El próximo evento de los tests de pendientes. */
function upcomingScrimmage(): EventRow {
  const row = event({
    startsOn: "2026-10-01",
    startTime: "19:00",
    eventType: "competition",
    title: "Partido amistoso",
  });
  club.events = [row];
  return row;
}

describe("la columna de cada rol (#746, D3)", () => {
  it("un Player no recibe pendientes ni números del club", async () => {
    const result = await dashboard();

    expect(result.column).toBe("player");
    expect(result).not.toHaveProperty("todos");
    expect(result).not.toHaveProperty("club");
  });

  it.each<Role>(["Admin", "Coach", "Committee"])(
    "un %s restringido no recibe pendientes ni números del club",
    async (role) => {
      club.role = role;
      club.membership = membershipWith("cancelled");

      const result = await restrictedDashboard();

      expect(result).not.toHaveProperty("todos");
      expect(result).not.toHaveProperty("club");
    },
  );

  it.each<Role>(["Admin", "Coach", "Committee"])(
    "un %s sin nada pendiente recibe la lista vacía y los números",
    async (role) => {
      club.role = role;

      const result = await managementDashboard();

      expect(result.todos).toEqual([]);
      expect(result.club.members).toEqual({ active: 1, joinedThisMonth: 0 });
    },
  );
});

describe("los pendientes (#746, D9 y D10)", () => {
  it("a un Admin le cuenta las solicitudes de rol pendientes, sin las de socios de baja", async () => {
    club.role = "Admin";
    club.pendingRequests = [
      pendingRequest(),
      pendingRequest(),
      pendingRequest("inactive"),
    ];

    await expect(todos()).resolves.toEqual([
      { kind: "role_requests", count: 2 },
    ]);
  });

  it.each<Role>(["Coach", "Committee"])(
    "a un %s nunca le da las solicitudes de rol",
    async (role) => {
      club.role = role;
      club.pendingRequests = [pendingRequest()];

      await expect(todos()).resolves.toEqual([]);
    },
  );

  it.each<Role>(["Admin", "Coach"])(
    "a un %s le da el entrenamiento sin hoja más reciente de los últimos 30 días, uno solo",
    async (role) => {
      club.role = role;
      const recent = training("2026-09-23T09:00:00.000Z", [], "Miércoles");
      club.recentTrainings = [
        training("2026-09-16T09:00:00.000Z"),
        recent,
        training("2026-09-28T09:00:00.000Z", ["present"]),
      ];

      await expect(todos()).resolves.toEqual([
        {
          kind: "attendance_missing",
          eventId: recent.eventId,
          title: "Miércoles",
          startsOn: "2026-09-23",
        },
      ]);
    },
  );

  it("da el día de Melbourne del entrenamiento sin hoja", async () => {
    club.role = "Coach";
    club.recentTrainings = [training("2026-09-22T21:30:00.000Z")];

    await expect(todos()).resolves.toMatchObject([
      { kind: "attendance_missing", startsOn: "2026-09-23" },
    ]);
  });

  it("no da asistencia pendiente con la hoja guardada, de hace más de 30 días ni de lo que no empezó", async () => {
    club.role = "Admin";
    club.recentTrainings = [
      training("2026-08-20T09:00:00.000Z"),
      training("2026-09-28T09:00:00.000Z", ["late"]),
      training("2026-09-30T09:00:00.000Z"),
    ];

    await expect(todos()).resolves.toEqual([]);
  });

  it("a un Committee nunca le da la asistencia pendiente", async () => {
    club.role = "Committee";
    club.recentTrainings = [training("2026-09-23T09:00:00.000Z")];

    await expect(todos()).resolves.toEqual([]);
  });

  it.each<Role>(["Admin", "Coach"])(
    "a un %s le da el reparto sin publicar del próximo evento",
    async (role) => {
      club.role = role;
      const row = upcomingScrimmage();
      club.splits.set(row.id, teamSplit(null));

      await expect(todos()).resolves.toEqual([
        {
          kind: "teams_unpublished",
          eventId: row.id,
          title: "Partido amistoso",
        },
      ]);
    },
  );

  it("no da reparto pendiente con el reparto publicado", async () => {
    club.role = "Coach";
    const row = upcomingScrimmage();
    club.splits.set(row.id, teamSplit(new Date("2026-09-29T00:00:00.000Z")));

    await expect(todos()).resolves.toEqual([]);
  });

  it("a un Committee nunca le da el reparto sin publicar", async () => {
    club.role = "Committee";
    const row = upcomingScrimmage();
    club.splits.set(row.id, teamSplit(null));

    await expect(todos()).resolves.toEqual([]);
  });

  it.each<Role>(["Admin", "Coach", "Committee"])(
    "a un %s le cuenta quién de la audiencia del próximo evento no ha respondido",
    async (role) => {
      club.role = role;
      const row = upcomingScrimmage();
      club.unanswered.set(row.id, 4);

      await expect(todos()).resolves.toEqual([
        {
          kind: "no_reply",
          eventId: row.id,
          title: "Partido amistoso",
          count: 4,
        },
      ]);
    },
  );

  it("no lo da con todos respondidos", async () => {
    club.role = "Committee";
    upcomingScrimmage();

    await expect(todos()).resolves.toEqual([]);
  });

  it("los da en el orden de la columna", async () => {
    club.role = "Admin";
    club.pendingRequests = [pendingRequest()];
    club.recentTrainings = [training("2026-09-23T09:00:00.000Z")];
    const row = upcomingScrimmage();
    club.splits.set(row.id, teamSplit(null));
    club.unanswered.set(row.id, 1);

    const result = await todos();

    expect(result.map(({ kind }) => kind)).toEqual([
      "role_requests",
      "attendance_missing",
      "teams_unpublished",
      "no_reply",
    ]);
  });

  it.each<[FakeSource, Role]>([
    ["roleRequests", "Admin"],
    ["sessions", "Coach"],
    ["unanswered", "Committee"],
    ["teams", "Admin"],
  ])(
    "sin %s, los pendientes de un %s no están disponibles y el resto se sirve",
    async (source, role) => {
      club.role = role;
      club.failing.add(source);
      upcomingScrimmage();

      const result = await managementDashboard();

      expect(result.todos).toEqual({ kind: "unavailable" });
      expect(result.club.members).toMatchObject({ active: 1 });
      expect(result.week).toMatchObject({ kind: "week" });
    },
  );
});

describe("los números del club (#746, D11)", () => {
  it.each<Role>(["Admin", "Coach", "Committee"])(
    "a un %s le compara la asistencia de los últimos 30 días con los 30 anteriores",
    async (role) => {
      club.role = role;
      club.clubRatesBySince.set("2026-09-01", {
        kind: "rate",
        percent: 82,
        records: 40,
      });
      club.clubRatesBySince.set("2026-08-02", {
        kind: "rate",
        percent: 77,
        records: 38,
      });

      const result = await managementDashboard();

      expect(result.club.attendance).toEqual({
        percent: 82,
        previousPercent: 77,
      });
      expect(clubRateWindows).toContainEqual({
        since: "2026-08-02",
        until: "2026-08-31",
      });
    },
  );

  it("deja en null el periodo sin datos", async () => {
    club.role = "Coach";
    club.clubRatesBySince.set("2026-08-02", { kind: "no_data" });

    const result = await managementDashboard();

    expect(result.club.attendance).toEqual({
      percent: 86,
      previousPercent: null,
    });
  });

  it("cuenta los socios activos y las altas desde el día 1 del mes del club", async () => {
    club.role = "Committee";
    club.activeMembers = { active: 31, joinedRecently: 2 };

    const result = await managementDashboard(
      new Date("2026-10-15T08:00:00.000Z"),
    );

    expect(result.club.members).toEqual({ active: 31, joinedThisMonth: 2 });
    expect(joinedSinceAsked).toContain("2026-10-01");
  });

  it("cuenta las noticias sin leer y los avisos entre ellas", async () => {
    club.role = "Admin";
    club.newsSeenAt = "2026-09-20T00:00:00.000Z";
    club.posts = [
      post({ publishedAt: "2026-09-25T00:00:00.000Z" }),
      post({
        publishedAt: "2026-09-26T00:00:00.000Z",
        category: "announcement",
      }),
      post({ publishedAt: "2026-09-10T00:00:00.000Z" }),
    ];

    const result = await managementDashboard();

    expect(result.club.unreadNews).toEqual({ count: 2, announcements: 1 });
  });

  it("sin la tasa del club, sólo cae su asistencia", async () => {
    club.role = "Committee";
    club.failing.add("clubRate");

    const result = await managementDashboard();

    expect(result.club.attendance).toEqual({ kind: "unavailable" });
    expect(result.club.members).toMatchObject({ active: 1 });
    expect(result.club.unreadNews).toMatchObject({ count: 0 });
    expect(reported.map(({ source }) => source)).toEqual(["club_attendance"]);
  });

  it("sin la fila de socios, caen los socios y las noticias sin leer", async () => {
    club.role = "Admin";
    club.failing.add("roster");

    const result = await managementDashboard();

    expect(result.club.members).toEqual({ kind: "unavailable" });
    expect(result.club.unreadNews).toEqual({ kind: "unavailable" });
    expect(result.club.attendance).toMatchObject({ percent: 86 });
  });
});
