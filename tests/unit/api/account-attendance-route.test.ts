import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberAttendance } from "@/lib/attendance/attendance-stats";
import type { OwnAttendanceGateways } from "@/lib/attendance/own-attendance";
import type { Role } from "@/lib/auth/roles";
import { ACCOUNT_ATTENDANCE_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";

/**
 * La asistencia propia por API (#394, FR-022): cualquier cuenta activa, de
 * cualquier rol, lee su porcentaje y su total. La petición entra por el proxy
 * y sólo llega al handler si la frontera la deja seguir, como en producción.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

const readSessionState = vi.fn();
let storedAttendance: MemberAttendance;
const attendanceAskedFor: (readonly string[])[] = [];

function ownAttendanceGateways(): OwnAttendanceGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Pía Player",
        role: "Player",
      }),
    },
    attendance: {
      findMemberAttendance: async (_clubId, userIds) => {
        attendanceAskedFor.push(userIds);
        return new Map(userIds.map((userId) => [userId, storedAttendance]));
      },
    },
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

vi.mock("@/lib/attendance/supabase-attendance-stats", () => ({
  createSupabaseOwnAttendanceGateways: () => ({
    kind: "ready",
    gateways: ownAttendanceGateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const route = await import("@/app/api/v1/account/attendance/route");

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

async function getOwnAttendance(): Promise<Response> {
  const request = new NextRequest(new URL(ACCOUNT_ATTENDANCE_API_PATH, ORIGIN));
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? route.GET(request)
    : boundaryResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  attendanceAskedFor.length = 0;
  storedAttendance = { kind: "rate", percent: 90, sessions: 9 };
});

describe("GET /api/v1/account/attendance", () => {
  it.each<Role>(["Admin", "Coach", "Committee", "Player"])(
    "sirve a un %s su porcentaje y su total",
    async (role) => {
      givenSession({ kind: "active", role, membershipCurrent: true });

      const response = await getOwnAttendance();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: { kind: "rate", percent: 90, sessions: 9 },
      });
      expect(attendanceAskedFor).toEqual([[USER_ID]]);
    },
  );

  it("dice sin datos a quien no tiene sesiones elegibles", async () => {
    givenSession({ kind: "active", role: "Player", membershipCurrent: true });
    storedAttendance = { kind: "no_data" };

    const response = await getOwnAttendance();

    await expect(response.json()).resolves.toEqual({
      data: { kind: "no_data" },
    });
  });

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await getOwnAttendance();

    expect(response.status).toBe(401);
  });

  it("no acepta escrituras", async () => {
    givenSession({ kind: "active", role: "Player", membershipCurrent: true });

    const response = await route.POST(
      new NextRequest(new URL(ACCOUNT_ATTENDANCE_API_PATH, ORIGIN), {
        method: "POST",
      }),
    );

    expect(response.status).toBe(405);
  });
});
