import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEMBERSHIP_NOT_CURRENT_REASON } from "@/lib/api/error-codes";
import type { Role } from "@/lib/auth/roles";
import { TRAINING_PLAN_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type { MembershipStatus } from "@/lib/membership/membership";
import type {
  TrainingCycleRecord,
  TrainingPlanGateways,
} from "@/lib/training/training-plan";

/**
 * La semana del ciclo activo por API (#898, RF-3 y RF-6 del PRD de E35). La
 * petición entra por el proxy y sólo llega al handler si la frontera la deja
 * seguir, como en producción: la puerta de estar al día la decide el
 * handler, porque su 403 lleva la cabecera del ciclo.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

const CYCLE: TrainingCycleRecord = {
  id: "cycle-1",
  name: "Nationals build",
  eventName: "Nationals",
  eventDate: "2026-10-31",
  startDate: "2026-09-28",
  weeks: 4,
};

const readSessionState = vi.fn();
const readAuthenticatedUserId = vi.fn();
let role: Role;
let membershipStatus: MembershipStatus;
let activeCycle: TrainingCycleRecord | null;

function trainingPlanGateways(): TrainingPlanGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Alba Ferrer",
        role,
      }),
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
    plan: {
      findActiveCycle: async () => activeCycle,
      findWeek: async () => ({ note: null, dose: null, days: [] }),
      exercisePhotoUrl: (path) => path,
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
  readAuthenticatedUserId: (...args: unknown[]) =>
    readAuthenticatedUserId(...args),
}));

vi.mock("@/lib/training/supabase-training-plan-gateways", () => ({
  createSupabaseTrainingPlanGateways: () => ({
    kind: "ready",
    gateways: trainingPlanGateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const route = await import("@/app/api/v1/training/plan/route");

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

function givenActiveCaller(callerRole: Role, isCurrent: boolean): void {
  role = callerRole;
  givenSession({
    kind: "active",
    role: callerRole,
    membershipCurrent: isCurrent,
  });
}

async function getPlan(query = ""): Promise<Response> {
  const request = new NextRequest(
    new URL(`${TRAINING_PLAN_API_PATH}${query}`, ORIGIN),
  );
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? route.GET(request)
    : boundaryResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  readAuthenticatedUserId.mockResolvedValue(USER_ID);
  membershipStatus = "active";
  activeCycle = CYCLE;
  givenActiveCaller("Player", true);
});

describe("GET /api/v1/training/plan", () => {
  it("sirve el ciclo, la semana actual y esa semana a un socio al día", async () => {
    const response = await getPlan();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({
      cycle: {
        name: "Nationals build",
        event: { name: "Nationals", date: "2026-10-31" },
        startDate: "2026-09-28",
        endDate: "2026-10-25",
        weeks: 4,
      },
      current: { week: expect.any(Number), phase: expect.any(String) },
      week: { note: null, dose: null },
    });
    expect(body.data.week.days).toHaveLength(7);
  });

  it("no se guarda en ninguna caché", () => {
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("con ?week=k sirve la semana k", async () => {
    const response = await getPlan("?week=3");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.week.number).toBe(3);
  });

  it.each(["0", "5", "abc", "2.5", "-1", ""])(
    "responde 400 a ?week=%s",
    async (week) => {
      const response = await getPlan(`?week=${week}`);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("validation_error");
    },
  );

  it("sin ciclo activo responde 200 con el ciclo nulo", async () => {
    activeCycle = null;

    const response = await getPlan();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { cycle: null } });
  });

  it.each<MembershipStatus>(["pending", "past_due", "cancelled"])(
    "a un socio %s le responde 403 con su motivo y la cabecera del ciclo",
    async (status) => {
      givenActiveCaller("Player", false);
      membershipStatus = status;

      const response = await getPlan();

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toMatchObject({
        code: "forbidden",
        reason: MEMBERSHIP_NOT_CURRENT_REASON,
        block: status,
        cycle: {
          name: "Nationals build",
          event: { name: "Nationals", date: "2026-10-31" },
          startDate: "2026-09-28",
          endDate: "2026-10-25",
        },
      });
      expect(body.error).not.toHaveProperty("week");
      expect(body.error.cycle).not.toHaveProperty("days");
    },
  );

  it.each<Role>(["Admin", "Coach"])(
    "a un %s sin la membresía al día le sirve el plan entero (D3)",
    async (plannerRole) => {
      givenActiveCaller(plannerRole, false);
      membershipStatus = "cancelled";

      const response = await getPlan();

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.week.days).toHaveLength(7);
    },
  );

  it("sin sesión responde 401", async () => {
    givenSession({ kind: "anonymous" });
    readAuthenticatedUserId.mockResolvedValue(null);

    const response = await getPlan();

    expect(response.status).toBe(401);
  });
});
