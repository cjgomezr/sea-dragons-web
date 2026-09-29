import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttendanceSessionsGateways } from "@/lib/attendance/attendance-sessions";
import type { Role } from "@/lib/auth/roles";
import {
  ATTENDANCE_SESSIONS_API_PATH,
  ATTENDANCE_SHEET_API_PATH,
} from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import {
  ATTENDANCE_CALLER_ID,
  ATTENDANCE_NOW,
  type FakeAttendanceClub,
  type FakeAttendanceClubOptions,
  STARTED_TRAINING,
  TRAINING_ID,
  fakeAttendanceClub,
  memberId,
} from "../helpers/attendance-club";

/**
 * Los endpoints de asistencia (#393, RF-2 a RF-4 del PRD de E8). La petición
 * entra por el proxy y sólo llega al handler si la frontera la deja seguir,
 * como en producción. El dominio va entero; sólo la base es un doble. Qué
 * decide cada caso lo prueba el dominio; aquí, que cada uno sale con su
 * código: 200, 400, 401, 403, 404 y 422.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const ANA = { userId: memberId(1), fullName: "Ana Zamora" };
const BRUNO = { userId: memberId(2), fullName: "Bruno Yáñez" };

const readSessionState = vi.fn();
let callerRole: Role = "Coach";
let club: FakeAttendanceClub;

function sessionsGateways(): AttendanceSessionsGateways {
  return {
    members: club.gateways.members,
    sessions: {
      findRecentTrainings: async () => [
        {
          eventId: TRAINING_ID,
          title: STARTED_TRAINING.title,
          startsAt: STARTED_TRAINING.startsAt,
          statuses: ["present", "late"],
        },
      ],
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
  readAuthenticatedUserId: async () => ATTENDANCE_CALLER_ID,
}));

vi.mock("@/lib/attendance/supabase-attendance-gateways", () => ({
  createSupabaseAttendanceGateways: () => ({
    kind: "ready",
    gateways: club.gateways,
  }),
  createSupabaseAttendanceSessionsGateways: () => ({
    kind: "ready",
    gateways: sessionsGateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const sheetRoute = await import("@/app/api/v1/attendance/[eventId]/route");
const sessionsRoute = await import("@/app/api/v1/attendance/sessions/route");

function givenClub(options: FakeAttendanceClubOptions = {}): void {
  club = fakeAttendanceClub({ callerRole, members: [ANA, BRUNO], ...options });
}

function givenSession(session: SessionState): void {
  if (session.kind === "active") {
    callerRole = session.role;
  }
  readSessionState.mockResolvedValue(session);
  givenClub();
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

function sheetRequest(eventId: string, body?: unknown): NextRequest {
  const url = new URL(
    ATTENDANCE_SHEET_API_PATH.replace("[eventId]", eventId),
    ORIGIN,
  );
  return body === undefined
    ? new NextRequest(url)
    : new NextRequest(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
}

function openSheet(eventId: string = TRAINING_ID): Promise<Response> {
  const request = sheetRequest(eventId);
  return throughProxy(request, () =>
    sheetRoute.GET(request, { params: Promise.resolve({ eventId }) }),
  );
}

function saveSheet(
  body: unknown,
  eventId: string = TRAINING_ID,
): Promise<Response> {
  const request = sheetRequest(eventId, body);
  return throughProxy(request, () =>
    sheetRoute.PUT(request, { params: Promise.resolve({ eventId }) }),
  );
}

function listSessions(): Promise<Response> {
  const request = new NextRequest(
    new URL(ATTENDANCE_SESSIONS_API_PATH, ORIGIN),
  );
  return throughProxy(request, () => sessionsRoute.GET(request));
}

async function expectError(
  response: Response,
  status: number,
  error: { readonly code: string; readonly reason?: string },
): Promise<void> {
  expect(response.status).toBe(status);
  const body = (await response.json()) as { error: Record<string, unknown> };
  expect(body.error).toMatchObject(error);
}

const EVERYONE_PRESENT = {
  records: [
    { userId: ANA.userId, status: "present" },
    { userId: BRUNO.userId, status: "late" },
  ],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(ATTENDANCE_NOW);
  readSessionState.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/v1/attendance/[eventId]", () => {
  it.each<Role>(["Coach", "Admin"])(
    "sirve a un %s la hoja con toda la audiencia, en absent sin RSVP",
    async (role) => {
      givenSession({ kind: "active", role });

      const response = await openSheet();

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: { members: { userId: string; status: string }[] };
      };
      expect(body.data.members.map((entry) => entry.status)).toEqual([
        "absent",
        "absent",
      ]);
    },
  );

  it.each<Role>(["Committee", "Player"])(
    "responde 403 a un %s",
    async (role) => {
      givenSession({ kind: "active", role });

      await expectError(await openSheet(), 403, { code: "forbidden" });
    },
  );

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    expect((await openSheet()).status).toBe(401);
  });

  it.each(["no-es-un-uuid", "e9e9e9e9-0000-4000-8000-00000000000e"])(
    "responde 404 con el evento %s",
    async (eventId) => {
      givenSession({ kind: "active", role: "Coach" });

      await expectError(await openSheet(eventId), 404, { code: "not_found" });
    },
  );

  it("responde 422 con un entrenamiento que todavía no empezó", async () => {
    givenSession({ kind: "active", role: "Coach" });
    givenClub({
      events: [
        {
          ...STARTED_TRAINING,
          startsAt: new Date(ATTENDANCE_NOW.getTime() + 60_000),
        },
      ],
    });

    await expectError(await openSheet(), 422, {
      code: "business_rule",
      reason: "attendance_session_not_started",
    });
  });

  it("responde 422 con un entrenamiento cancelado", async () => {
    givenSession({ kind: "active", role: "Coach" });
    givenClub({ events: [{ ...STARTED_TRAINING, status: "cancelled" }] });

    await expectError(await openSheet(), 422, {
      code: "business_rule",
      reason: "attendance_session_cancelled",
    });
  });
});

describe("PUT /api/v1/attendance/[eventId]", () => {
  it("guarda la hoja y responde 200 con los totales", async () => {
    givenSession({ kind: "active", role: "Coach" });

    const response = await saveSheet(EVERYONE_PRESENT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        eventId: TRAINING_ID,
        totals: { present: 1, late: 1, absent: 0 },
      },
    });
    expect(club.auditActions).toHaveLength(1);
  });

  it.each([
    ["un estado fuera del catálogo", [{ userId: memberId(1), status: "x" }]],
    [
      "un miembro repetido",
      [
        { userId: memberId(1), status: "present" },
        { userId: memberId(1), status: "late" },
      ],
    ],
    ["un id que no es uuid", [{ userId: "ana", status: "present" }]],
    ["una lista vacía", []],
  ])("responde 400 con %s y no escribe nada", async (_, records) => {
    givenSession({ kind: "active", role: "Coach" });

    await expectError(await saveSheet({ records }), 400, {
      code: "validation_error",
    });
    expect(club.writes).toEqual([]);
  });

  it("responde 422 con alguien que no es de la hoja", async () => {
    givenSession({ kind: "active", role: "Coach" });

    await expectError(
      await saveSheet({
        records: [{ userId: memberId(9), status: "present" }],
      }),
      422,
      { code: "business_rule", reason: "attendance_member_outside_sheet" },
    );
    expect(club.writes).toEqual([]);
  });

  it("responde 422 con un entrenamiento cancelado", async () => {
    givenSession({ kind: "active", role: "Coach" });
    givenClub({ events: [{ ...STARTED_TRAINING, status: "cancelled" }] });

    await expectError(await saveSheet(EVERYONE_PRESENT), 422, {
      code: "business_rule",
      reason: "attendance_session_cancelled",
    });
  });

  it("responde 404 con un evento que no existe", async () => {
    givenSession({ kind: "active", role: "Coach" });

    await expectError(
      await saveSheet(EVERYONE_PRESENT, "e9e9e9e9-0000-4000-8000-00000000000e"),
      404,
      { code: "not_found" },
    );
  });

  it.each<Role>(["Committee", "Player"])(
    "responde 403 a un %s",
    async (role) => {
      givenSession({ kind: "active", role });

      await expectError(await saveSheet(EVERYONE_PRESENT), 403, {
        code: "forbidden",
      });
    },
  );

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    expect((await saveSheet(EVERYONE_PRESENT)).status).toBe(401);
  });
});

describe("GET /api/v1/attendance/sessions", () => {
  it.each<Role>(["Coach", "Admin"])(
    "sirve a un %s las sesiones con sus totales",
    async (role) => {
      givenSession({ kind: "active", role });

      const response = await listSessions();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: {
          sessions: [
            {
              eventId: TRAINING_ID,
              title: STARTED_TRAINING.title,
              startsAt: STARTED_TRAINING.startsAt.toISOString(),
              hasSheet: true,
              totals: { present: 1, late: 1, absent: 0 },
            },
          ],
        },
      });
    },
  );

  it.each<Role>(["Committee", "Player"])(
    "responde 403 a un %s",
    async (role) => {
      givenSession({ kind: "active", role });

      await expectError(await listSessions(), 403, { code: "forbidden" });
    },
  );

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    expect((await listSessions()).status).toBe(401);
  });
});
