import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { DASHBOARD_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type { DashboardGateways } from "@/lib/dashboard/dashboard";
import type { MembershipStatus } from "@/lib/membership/membership";

/**
 * El dashboard por API (#424, RF-6 del PRD de E14): una sola petición para
 * todo lo que pinta el inicio. La petición entra por el proxy y sólo llega al
 * handler si la frontera la deja seguir, como en producción.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

const readSessionState = vi.fn();
let memberExists: boolean;
let role: Role;
let clubRateFails: boolean;
let membershipStatus: MembershipStatus;

function unused(): never {
  throw new Error("el dashboard no escribe");
}

function dashboardGateways(): DashboardGateways {
  const members = {
    findRoleRequestMember: async () =>
      memberExists ? { clubId: CLUB_ID, fullName: "Alba Ferrer", role } : null,
  };
  const memberGroups = { listGroupsOf: async () => [] };
  return {
    members,
    clubRate: {
      members,
      clubRate: {
        findClubAttendanceRate: async () => {
          if (clubRateFails) {
            throw new Error("la base no contesta");
          }
          return { kind: "rate", percent: 86, records: 42 };
        },
      },
    },
    ownAttendance: {
      members,
      attendance: {
        findMemberAttendance: async () =>
          new Map([[USER_ID, { kind: "no_data" } as const]]),
      },
    },
    agenda: {
      members,
      memberGroups,
      agenda: {
        findAgendaPage: async () => [],
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
        insertPost: unused,
        findFeedPage: async () => [],
        findPost: async () => null,
        deletePost: unused,
        updatePost: unused,
        setPostStatus: unused,
      },
      audit: { insertAuditLogRow: unused },
    },
    roster: {
      countActiveMembers: async () => ({ active: 1, joinedRecently: 1 }),
      findNewsSeenAt: async () => null,
    },
    membership: {
      findByUserId: async () => ({
        userId: USER_ID,
        clubId: CLUB_ID,
        plan: "Full",
        status: membershipStatus,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        currentPeriodEnd: null,
        trialEnd: null,
        card: null,
        waiver: null,
        scheduledChange: null,
      }),
    },
    failures: { report: () => undefined },
  };
}

vi.mock("@/lib/supabase/session-client", () => ({
  readIncomingCookies: () => [],
  applySessionCookies: () => undefined,
  createSessionClient: () => ({
    kind: "ready",
    client: {},
    recorder: { recorded: () => ({ cookies: [], headers: {} }) },
  }),
}));

vi.mock("@/lib/auth/session-reader", () => ({
  readSessionState: (...args: unknown[]) => readSessionState(...args),
  readAuthenticatedUserId: async () => USER_ID,
}));

vi.mock("@/lib/dashboard/supabase-dashboard-gateways", () => ({
  createSupabaseDashboardGateways: () => ({
    kind: "ready",
    gateways: dashboardGateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const route = await import("@/app/api/v1/dashboard/route");

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

async function getDashboard(): Promise<Response> {
  const request = new NextRequest(new URL(DASHBOARD_API_PATH, ORIGIN));
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? route.GET(request)
    : boundaryResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  memberExists = true;
  role = "Player";
  clubRateFails = false;
  membershipStatus = "active";
});

describe("GET /api/v1/dashboard", () => {
  it.each<Role>(["Admin", "Coach", "Committee", "Player"])(
    "sirve el dashboard a un %s",
    async (sessionRole) => {
      givenSession({
        kind: "active",
        role: sessionRole,
        membershipCurrent: true,
      });
      role = sessionRole;

      const response = await getDashboard();

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.tiles.members).toEqual({
        kind: "members",
        active: 1,
        joinedRecently: 1,
      });
    },
  );

  it("sirve la tasa del club a un Coach", async () => {
    givenSession({ kind: "active", role: "Coach", membershipCurrent: true });
    role = "Coach";

    const response = await getDashboard();

    const body = await response.json();
    expect(body.data.tiles.attendance).toEqual({
      kind: "club_rate",
      rate: { kind: "rate", percent: 86, records: 42 },
    });
  });

  it("un club recién creado recibe cada parte vacía", async () => {
    givenSession({ kind: "active", role: "Player", membershipCurrent: true });

    const response = await getDashboard();

    await expect(response.json()).resolves.toEqual({
      data: {
        kind: "member",
        viewer: { firstName: "Alba" },
        tiles: {
          attendance: {
            kind: "own_attendance",
            attendance: { kind: "no_data" },
          },
          members: { kind: "members", active: 1, joinedRecently: 1 },
          nextTraining: { kind: "none" },
          unreadNews: { kind: "unread", count: 0, announcements: 0 },
        },
        upcomingEvents: { kind: "events", events: [] },
        latestNews: { kind: "news", posts: [] },
      },
    });
  });

  it("responde 200 con la tesela caída marcada como no disponible", async () => {
    givenSession({ kind: "active", role: "Admin", membershipCurrent: true });
    role = "Admin";
    clubRateFails = true;

    const response = await getDashboard();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.tiles.attendance).toEqual({ kind: "unavailable" });
    expect(body.data.latestNews).toEqual({ kind: "news", posts: [] });
  });

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await getDashboard();

    expect(response.status).toBe(401);
  });

  it("responde 403 a una cuenta incompleta", async () => {
    givenSession({ kind: "incomplete" });

    const response = await getDashboard();

    expect(response.status).toBe(403);
  });

  it("responde 403 a una sesión que no corresponde a ningún socio", async () => {
    givenSession({ kind: "active", role: "Player", membershipCurrent: true });
    memberExists = false;

    const response = await getDashboard();

    expect(response.status).toBe(403);
  });

  it("no acepta escrituras", async () => {
    const response = await route.POST(
      new NextRequest(new URL(DASHBOARD_API_PATH, ORIGIN), { method: "POST" }),
    );

    expect(response.status).toBe(405);
  });
});

describe("GET /api/v1/dashboard sin la membresía al día (#453)", () => {
  it("sirve el inicio reducido, sin teselas ni noticias", async () => {
    givenSession({ kind: "active", role: "Player", membershipCurrent: false });
    membershipStatus = "past_due";

    const response = await getDashboard();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        kind: "restricted",
        viewer: { firstName: "Alba" },
        block: "past_due",
        nextTraining: { kind: "none" },
      },
    });
  });
});
