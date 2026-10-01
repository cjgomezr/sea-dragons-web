import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClubAttendanceRate } from "@/lib/attendance/attendance-stats";
import type { ClubAttendanceRateGateways } from "@/lib/attendance/club-attendance-rate";
import type { Role } from "@/lib/auth/roles";
import { ATTENDANCE_CLUB_RATE_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";

/**
 * La tasa de asistencia del club por API (#394, RF-7 del PRD de E8). La
 * petición entra por el proxy y sólo llega al handler si la frontera la deja
 * seguir, como en producción. El dominio va entero; sólo la base es un doble.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const CALLER_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

const readSessionState = vi.fn();
let callerRole: Role;
let storedRate: ClubAttendanceRate;

function clubRateGateways(): ClubAttendanceRateGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Carla Coach",
        role: callerRole,
      }),
    },
    clubRate: { findClubAttendanceRate: async () => storedRate },
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
  readAuthenticatedUserId: async () => CALLER_ID,
}));

vi.mock("@/lib/attendance/supabase-attendance-stats", () => ({
  createSupabaseClubAttendanceRateGateways: () => ({
    kind: "ready",
    gateways: clubRateGateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const route = await import("@/app/api/v1/attendance/club-rate/route");

function givenSession(session: SessionState): void {
  if (session.kind === "active") {
    callerRole = session.role;
  }
  readSessionState.mockResolvedValue(session);
}

async function getClubRate(): Promise<Response> {
  const request = new NextRequest(
    new URL(ATTENDANCE_CLUB_RATE_API_PATH, ORIGIN),
  );
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? route.GET(request)
    : boundaryResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  storedRate = { kind: "rate", percent: 75, records: 4 };
});

describe("GET /api/v1/attendance/club-rate", () => {
  it.each<Role>(["Admin", "Coach"])(
    "sirve a un %s la tasa del club",
    async (role) => {
      givenSession({ kind: "active", role, membershipCurrent: true });

      const response = await getClubRate();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: { kind: "rate", percent: 75, records: 4 },
      });
    },
  );

  it("dice sin datos cuando el club no tiene ninguna hoja", async () => {
    givenSession({ kind: "active", role: "Coach", membershipCurrent: true });
    storedRate = { kind: "no_data" };

    const response = await getClubRate();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { kind: "no_data" },
    });
  });

  it.each<Role>(["Committee", "Player"])(
    "responde 403 a un %s",
    async (role) => {
      givenSession({ kind: "active", role, membershipCurrent: true });

      const response = await getClubRate();

      expect(response.status).toBe(403);
    },
  );

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await getClubRate();

    expect(response.status).toBe(401);
  });

  it("no acepta escrituras", async () => {
    givenSession({ kind: "active", role: "Coach", membershipCurrent: true });

    const response = await route.POST(
      new NextRequest(new URL(ATTENDANCE_CLUB_RATE_API_PATH, ORIGIN), {
        method: "POST",
      }),
    );

    expect(response.status).toBe(405);
  });
});
