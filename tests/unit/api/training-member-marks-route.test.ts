import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEMBERSHIP_NOT_CURRENT_REASON } from "@/lib/api/error-codes";
import type { Role } from "@/lib/auth/roles";
import { TRAINING_MY_MARKS_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type { MembershipStatus } from "@/lib/membership/membership";
import type { MemberMarksGateways } from "@/lib/training/member-marks";

/**
 * Mis marcas por API (#899, RF-5 y D11 del PRD de E35). La petición entra por
 * el proxy y sólo llega al handler si la frontera la deja seguir, como en
 * producción: la puerta de estar al día la decide el handler, como en el plan.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const SQUAT_ID = "1b2c3d4e-0000-4000-8000-000000000001";
const UNKNOWN_MARK_ID = "1b2c3d4e-0000-4000-8000-0000000000ff";

const readSessionState = vi.fn();
const readAuthenticatedUserId = vi.fn();
const saveValue = vi.fn();
const clearValue = vi.fn();
let role: Role;
let membershipStatus: MembershipStatus;
let storedValue: number | null;

function memberMarksGateways(): MemberMarksGateways {
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
    marks: {
      listClubMarks: async () => [{ id: SQUAT_ID, name: "Back squat 1RM" }],
      listMemberValues: async () =>
        storedValue === null ? [] : [{ markId: SQUAT_ID, value: storedValue }],
      saveValue: async (entry) => {
        saveValue(entry);
        storedValue = entry.value;
      },
      clearValue: async (entry) => {
        clearValue(entry);
        storedValue = null;
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
  readAuthenticatedUserId: (...args: unknown[]) =>
    readAuthenticatedUserId(...args),
}));

vi.mock("@/lib/training/supabase-member-marks-gateways", () => ({
  createSupabaseMemberMarksGateways: () => ({
    kind: "ready",
    gateways: memberMarksGateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const listRoute = await import("@/app/api/v1/training/marks/me/route");
const markRoute = await import("@/app/api/v1/training/marks/[markId]/me/route");

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

function markPath(markId: string): string {
  return `/api/v1/training/marks/${markId}/me`;
}

async function throughProxy(
  request: NextRequest,
  handle: () => Promise<Response>,
): Promise<Response> {
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? handle()
    : boundaryResponse;
}

function getMyMarks(): Promise<Response> {
  const request = new NextRequest(new URL(TRAINING_MY_MARKS_API_PATH, ORIGIN));
  return throughProxy(request, () => listRoute.GET(request));
}

function putMark(markId: string, body: string): Promise<Response> {
  const request = new NextRequest(new URL(markPath(markId), ORIGIN), {
    method: "PUT",
    body,
    headers: { "content-type": "application/json" },
  });
  return throughProxy(request, () =>
    markRoute.PUT(request, { params: Promise.resolve({ markId }) }),
  );
}

function deleteMark(markId: string): Promise<Response> {
  const request = new NextRequest(new URL(markPath(markId), ORIGIN), {
    method: "DELETE",
  });
  return throughProxy(request, () =>
    markRoute.DELETE(request, { params: Promise.resolve({ markId }) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  readAuthenticatedUserId.mockResolvedValue(USER_ID);
  membershipStatus = "active";
  storedValue = null;
  givenActiveCaller("Player", true);
});

describe("GET /api/v1/training/marks/me", () => {
  it("devuelve las marcas del club con el valor del socio o nulo", async () => {
    const response = await getMyMarks();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        marks: [
          { id: SQUAT_ID, name: "Back squat 1RM", unit: "kg", value: null },
        ],
      },
    });
  });

  it("no se guarda en ninguna caché", () => {
    expect(listRoute.dynamic).toBe("force-dynamic");
    expect(markRoute.dynamic).toBe("force-dynamic");
  });

  it.each<MembershipStatus>(["pending", "past_due", "cancelled"])(
    "a un socio %s le responde 403 con su motivo",
    async (status) => {
      givenActiveCaller("Player", false);
      membershipStatus = status;

      const response = await getMyMarks();

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toMatchObject({
        code: "forbidden",
        reason: MEMBERSHIP_NOT_CURRENT_REASON,
        block: status,
      });
    },
  );

  it.each<Role>(["Admin", "Coach"])(
    "a un %s sin la membresía al día le sirve sus marcas (D3)",
    async (plannerRole) => {
      givenActiveCaller(plannerRole, false);
      membershipStatus = "cancelled";

      const response = await getMyMarks();

      expect(response.status).toBe(200);
    },
  );

  it("sin sesión responde 401", async () => {
    givenSession({ kind: "anonymous" });
    readAuthenticatedUserId.mockResolvedValue(null);

    const response = await getMyMarks();

    expect(response.status).toBe(401);
  });
});

describe("PUT /api/v1/training/marks/{markId}/me", () => {
  it("guarda el valor para el socio de la sesión y responde la lista", async () => {
    const response = await putMark(SQUAT_ID, JSON.stringify({ value: 82.5 }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.marks[0].value).toBe(82.5);
    expect(saveValue).toHaveBeenCalledWith({
      userId: USER_ID,
      clubId: CLUB_ID,
      markId: SQUAT_ID,
      value: 82.5,
    });
  });

  it.each([
    ["cero", "0"],
    ["un negativo", "-5"],
    ["más de 500", "500.1"],
    ["dos decimales", "82.55"],
    ["un texto", '"80"'],
    ["nulo", "null"],
  ])("responde 400 a %s y no guarda nada", async (_label, value) => {
    const response = await putMark(SQUAT_ID, `{ "value": ${value} }`);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("validation_error");
    expect(saveValue).not.toHaveBeenCalled();
  });

  it("responde 400 a un cuerpo sin valor", async () => {
    const response = await putMark(SQUAT_ID, "{}");

    expect(response.status).toBe(400);
    expect(saveValue).not.toHaveBeenCalled();
  });

  it("no acepta el socio en el cuerpo", async () => {
    const response = await putMark(
      SQUAT_ID,
      JSON.stringify({ value: 80, userId: "otro-socio" }),
    );

    expect(response.status).toBe(400);
    expect(saveValue).not.toHaveBeenCalled();
  });

  it("responde 404 a una marca que no es del club", async () => {
    const response = await putMark(UNKNOWN_MARK_ID, '{ "value": 80 }');

    expect(response.status).toBe(404);
    expect(saveValue).not.toHaveBeenCalled();
  });

  it("responde 404 a un id que no es un uuid", async () => {
    const response = await putMark("no-es-un-uuid", '{ "value": 80 }');

    expect(response.status).toBe(404);
    expect(saveValue).not.toHaveBeenCalled();
  });

  it("a un socio que no está al día le responde 403 y no guarda", async () => {
    givenActiveCaller("Player", false);
    membershipStatus = "past_due";

    const response = await putMark(SQUAT_ID, '{ "value": 80 }');

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toMatchObject({
      reason: MEMBERSHIP_NOT_CURRENT_REASON,
      block: "past_due",
    });
    expect(saveValue).not.toHaveBeenCalled();
  });

  it("sin sesión responde 401", async () => {
    givenSession({ kind: "anonymous" });
    readAuthenticatedUserId.mockResolvedValue(null);

    const response = await putMark(SQUAT_ID, '{ "value": 80 }');

    expect(response.status).toBe(401);
  });
});

describe("DELETE /api/v1/training/marks/{markId}/me", () => {
  it("deja la marca sin valor y responde la lista", async () => {
    storedValue = 90;

    const response = await deleteMark(SQUAT_ID);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.marks[0].value).toBeNull();
    expect(clearValue).toHaveBeenCalledWith({
      userId: USER_ID,
      clubId: CLUB_ID,
      markId: SQUAT_ID,
    });
  });

  it("responde igual si la marca ya no tenía valor", async () => {
    const response = await deleteMark(SQUAT_ID);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.marks[0].value).toBeNull();
  });

  it("responde 404 a una marca que no es del club", async () => {
    const response = await deleteMark(UNKNOWN_MARK_ID);

    expect(response.status).toBe(404);
    expect(clearValue).not.toHaveBeenCalled();
  });

  it("a un socio que no está al día le responde 403", async () => {
    givenActiveCaller("Player", false);
    membershipStatus = "cancelled";

    const response = await deleteMark(SQUAT_ID);

    expect(response.status).toBe(403);
    expect(clearValue).not.toHaveBeenCalled();
  });

  it("sin sesión responde 401", async () => {
    givenSession({ kind: "anonymous" });
    readAuthenticatedUserId.mockResolvedValue(null);

    const response = await deleteMark(SQUAT_ID);

    expect(response.status).toBe(401);
  });
});
