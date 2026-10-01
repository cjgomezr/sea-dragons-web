import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { EVALUATIONS_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type {
  EvaluationRosterGateways,
  RosterMemberRecord,
} from "@/lib/evaluations/evaluation-roster";

/**
 * La lista de Evaluaciones por API (#322). La petición entra por el proxy y
 * sólo llega al handler si la frontera la deja seguir, como en producción. El
 * dominio va entero; sólo la base es un doble.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const CALLER_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

const PLAYER: RosterMemberRecord = {
  userId: "4e4e4e4e-0000-4000-8000-000000000001",
  fullName: "Pía Player",
  status: "active",
  ratings: [7, 8],
};

const readSessionState = vi.fn();
let callerRole: Role;

function rosterGateways(): EvaluationRosterGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Carla Coach",
        role: callerRole,
      }),
    },
    roster: { findRosterMembers: async () => [PLAYER] },
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

vi.mock("@/lib/evaluations/supabase-evaluation-roster-gateways", () => ({
  createSupabaseEvaluationRosterGateways: () => ({
    kind: "ready",
    gateways: rosterGateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const route = await import("@/app/api/v1/evaluations/route");

function givenSession(session: SessionState): void {
  if (session.kind === "active") {
    callerRole = session.role;
  }
  readSessionState.mockResolvedValue(session);
}

async function getRoster(): Promise<Response> {
  const request = new NextRequest(new URL(EVALUATIONS_API_PATH, ORIGIN));
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? route.GET(request)
    : boundaryResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/evaluations", () => {
  it.each<Role>(["Coach", "Admin"])(
    "sirve a un %s los miembros con su OVR",
    async (role) => {
      givenSession({ kind: "active", role, membershipCurrent: true });

      const response = await getRoster();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: {
          members: [
            {
              status: "evaluated",
              userId: PLAYER.userId,
              fullName: PLAYER.fullName,
              overallRating: 7.5,
            },
          ],
        },
      });
    },
  );

  it.each<Role>(["Player", "Committee"])(
    "responde 403 a un %s",
    async (role) => {
      givenSession({ kind: "active", role, membershipCurrent: true });

      const response = await getRoster();

      expect(response.status).toBe(403);
    },
  );

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await getRoster();

    expect(response.status).toBe(401);
  });

  it("no acepta escrituras en la lista", async () => {
    givenSession({ kind: "active", role: "Coach", membershipCurrent: true });

    const response = await route.POST(
      new NextRequest(new URL(EVALUATIONS_API_PATH, ORIGIN), {
        method: "POST",
      }),
    );

    expect(response.status).toBe(405);
  });
});
