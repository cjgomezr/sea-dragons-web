import { beforeEach, describe, expect, it } from "vitest";
import type {
  ClubAttendanceRate,
  MemberAttendance,
} from "@/lib/attendance/attendance-stats";
import type { ClubRateWindow } from "@/lib/attendance/club-attendance-rate";
import type { Role } from "@/lib/auth/roles";
import {
  type DashboardGateways,
  type DashboardSource,
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
} from "@/lib/events/event-agenda";
import type {
  NewsCategory,
  NewsFeedQuery,
  NewsFeedRow,
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
  | "contact";

type Club = {
  role: Role;
  groupIds: string[];
  events: EventRow[];
  posts: NewsFeedRow[];
  clubRate: ClubAttendanceRate;
  ownAttendance: MemberAttendance;
  activeMembers: { active: number; joinedRecently: number };
  newsSeenAt: string | null;
  /** El teléfono y el contacto de emergencia de quien mira (#498). */
  contact: ProfileContact;
  /** La membresía de quien mira; `null` si no tiene. */
  membership: MembershipRecord | null;
  failing: Set<FakeSource>;
};

let club: Club;
const clubRateWindows: ClubRateWindow[] = [];
const joinedSinceAsked: string[] = [];
const reported: { source: DashboardSource; error: unknown }[] = [];

function failIf(source: FakeSource): void {
  if (club.failing.has(source)) {
    throw new Error(`la base no contesta: ${source}`);
  }
}

let nextId = 0;
function uuid(): string {
  nextId += 1;
  return `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`;
}

function event(overrides: {
  startsOn: string;
  startTime: string;
  eventType?: EventType;
  status?: EventStatus;
  groupIds?: string[];
  title?: string;
}): EventRow {
  const { groupIds, ...rest } = overrides;
  return {
    id: uuid(),
    startsAt: `${overrides.startsOn}T${overrides.startTime}:00+10:00`,
    title: "Entrenamiento del miércoles",
    eventType: "training",
    location: "MSAC",
    notes: null,
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
}): NewsFeedRow {
  return {
    id: uuid(),
    category: "news",
    title: "Crónica del torneo",
    body: "Ganamos los tres partidos.",
    author: { id: CALLER_ID, fullName: "Alba Ferrer" },
    status: "published",
    attachmentCount: 0,
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

function findAgendaPage(query: AgendaQuery): readonly EventRow[] {
  failIf("agenda");
  return club.events
    .filter((row) => row.startsOn >= query.today && isVisible(row, query))
    .sort((first, second) => first.startsAt.localeCompare(second.startsAt))
    .slice(0, query.limit);
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
          return club.clubRate;
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
        findEvent: async () => null,
        countResponses: async () => [],
        listResponders: async () => [],
      },
    },
    news: {
      members,
      memberGroups,
      posts: {
        findClubGroupIds: async () => new Set(),
        insertPost: async () => {
          throw new Error("el dashboard no publica");
        },
        findFeedPage: async (query) => findFeedPage(query),
        findPost: async () => null,
        deletePost: async () => undefined,
        updatePost: async () => ({ kind: "updated" }),
        setPostStatus: async () => undefined,
      },
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
    failures: {
      report: (source, error) => {
        reported.push({ source, error });
      },
    },
  };
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
async function dashboard(): Promise<MemberDashboard> {
  const result = await readDashboard(gateways(), {
    callerId: CALLER_ID,
    now: NOW,
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
  reported.length = 0;
  club = {
    role: "Player",
    groupIds: [],
    events: [],
    posts: [],
    clubRate: { kind: "rate", percent: 86, records: 42 },
    ownAttendance: { kind: "rate", percent: 75, sessions: 6 },
    activeMembers: { active: 1, joinedRecently: 0 },
    newsSeenAt: null,
    contact: { phone: "0412 345 678", emergencyContact: SISTER },
    membership: membershipWith("active"),
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
      expect(clubRateWindows).toEqual([
        { since: "2026-09-01", until: TODAY_IN_CLUB },
      ]);
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
      expect(clubRateWindows).toEqual([]);
    },
  );

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
        },
        {
          id: second.id,
          category: "news",
          title: "Crónica del torneo",
          publishedAt: "2026-09-27T00:00:00.000Z",
        },
        {
          id: third.id,
          category: "document",
          title: "Crónica del torneo",
          publishedAt: "2026-09-20T00:00:00.000Z",
        },
      ],
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

    expect(reported).toEqual([
      {
        source: "attendance",
        error: new Error("la base no contesta: clubRate"),
      },
    ]);
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
      viewer: { firstName: "Alba" },
      tiles: {
        attendance: { kind: "own_attendance", attendance: { kind: "no_data" } },
        members: { kind: "members", active: 1, joinedRecently: 0 },
        nextTraining: { kind: "none" },
        unreadNews: { kind: "unread", count: 0, announcements: 0 },
      },
      upcomingEvents: { kind: "events", events: [] },
      latestNews: { kind: "news", posts: [] },
      contactReminder: { kind: "reminder", reminder: "none" },
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

  it("no le da teselas de club ni noticias", async () => {
    club.membership = membershipWith("pending");
    club.posts = [post({ publishedAt: "2026-09-29T08:00:00.000Z" })];

    const result = await restrictedDashboard();

    expect(Object.keys(result).sort()).toEqual([
      "block",
      "contactReminder",
      "kind",
      "nextTraining",
      "viewer",
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
