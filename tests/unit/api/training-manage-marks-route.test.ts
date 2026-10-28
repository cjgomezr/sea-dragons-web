import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import {
  TRAINING_MANAGE_MARKS_API_PATH,
  trainingManageMarkApiPath,
} from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type {
  ClubMarkRecord,
  ClubMarksGateways,
} from "@/lib/training/club-marks";

/**
 * Las marcas del club por API (#903, RF-11 y D11 del PRD de E35). La
 * petición entra por el proxy y sólo llega al handler si la frontera la deja
 * seguir, como en producción.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const COACH_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const SQUAT_ID = "1b2c3d4e-0000-4000-8000-000000000001";
const BENCH_ID = "1b2c3d4e-0000-4000-8000-000000000002";
const NEW_MARK_ID = "1b2c3d4e-0000-4000-8000-000000000003";
const OTHER_CLUBS_MARK_ID = "1b2c3d4e-0000-4000-8000-0000000000ff";

const readSessionState = vi.fn();
const readAuthenticatedUserId = vi.fn();
const insertAuditLogRow = vi.fn();
const deleteMark = vi.fn();
let marks: ClubMarkRecord[];

function mark(
  id: string,
  name: string,
  counts: { readonly routineRows: number; readonly membersRecorded: number },
): ClubMarkRecord {
  return { id, name, sortOrder: 0, ...counts };
}

function clubMarksGateways(): ClubMarksGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Cora Coach",
        role: "Coach",
      }),
    },
    marks: {
      listMarks: async () => [...marks],
      insertMark: async ({ name }) => {
        if (marks.some((existing) => existing.name === name)) {
          return { kind: "name_taken" };
        }
        marks.push(
          mark(NEW_MARK_ID, name, { routineRows: 0, membersRecorded: 0 }),
        );
        return { kind: "created", markId: NEW_MARK_ID };
      },
      renameMark: async ({ markId }, name) => {
        if (!marks.some((existing) => existing.id === markId)) {
          return { kind: "not_found" };
        }
        marks = marks.map((existing) =>
          existing.id === markId ? { ...existing, name } : existing,
        );
        return { kind: "renamed" };
      },
      deleteMark: async (target) => {
        deleteMark(target);
        marks = marks.filter((existing) => existing.id !== target.markId);
        return { kind: "deleted" };
      },
    },
    audit: {
      insertAuditLogRow: async (row) => {
        insertAuditLogRow(row);
        return { error: null };
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

vi.mock("@/lib/training/supabase-club-marks-gateways", () => ({
  createSupabaseClubMarksGateways: () => ({
    kind: "ready",
    gateways: clubMarksGateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const listRoute = await import("@/app/api/v1/training/manage/marks/route");
const markRoute =
  await import("@/app/api/v1/training/manage/marks/[markId]/route");

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

function givenCaller(role: Role): void {
  givenSession({ kind: "active", role, membershipCurrent: true });
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

function jsonRequest(path: string, method: string, body: string): NextRequest {
  return new NextRequest(new URL(path, ORIGIN), {
    method,
    body,
    headers: { "content-type": "application/json" },
  });
}

function getMarks(): Promise<Response> {
  const request = new NextRequest(
    new URL(TRAINING_MANAGE_MARKS_API_PATH, ORIGIN),
  );
  return throughProxy(request, () => listRoute.GET(request));
}

function postMark(body: string): Promise<Response> {
  const request = jsonRequest(TRAINING_MANAGE_MARKS_API_PATH, "POST", body);
  return throughProxy(request, () => listRoute.POST(request));
}

function patchMark(markId: string, body: string): Promise<Response> {
  const request = jsonRequest(trainingManageMarkApiPath(markId), "PATCH", body);
  return throughProxy(request, () =>
    markRoute.PATCH(request, { params: Promise.resolve({ markId }) }),
  );
}

function deleteMarkRequest(markId: string, query = ""): Promise<Response> {
  const request = new NextRequest(
    new URL(`${trainingManageMarkApiPath(markId)}${query}`, ORIGIN),
    { method: "DELETE" },
  );
  return throughProxy(request, () =>
    markRoute.DELETE(request, { params: Promise.resolve({ markId }) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  readAuthenticatedUserId.mockResolvedValue(COACH_ID);
  givenCaller("Coach");
  marks = [
    mark(SQUAT_ID, "Back squat", { routineRows: 2, membersRecorded: 5 }),
    mark(BENCH_ID, "Bench press", { routineRows: 0, membersRecorded: 3 }),
  ];
});

describe("GET /api/v1/training/manage/marks", () => {
  it("devuelve las marcas con sus cuentas, sin valores ni nombres de socios", async () => {
    const response = await getMarks();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        marks: [
          {
            id: SQUAT_ID,
            name: "Back squat",
            unit: "kg",
            routineRows: 2,
            membersRecorded: 5,
          },
          {
            id: BENCH_ID,
            name: "Bench press",
            unit: "kg",
            routineRows: 0,
            membersRecorded: 3,
          },
        ],
      },
    });
  });

  it("no se guarda en ninguna caché", () => {
    expect(listRoute.dynamic).toBe("force-dynamic");
    expect(markRoute.dynamic).toBe("force-dynamic");
  });

  it.each<Role>(["Player", "Committee"])(
    "a un %s le responde 403",
    async (role) => {
      givenCaller(role);

      const response = await getMarks();

      expect(response.status).toBe(403);
    },
  );

  it.each<Role>(["Admin", "Coach"])("a un %s se las sirve", async (role) => {
    givenCaller(role);

    const response = await getMarks();

    expect(response.status).toBe(200);
  });

  it("sin sesión responde 401", async () => {
    givenSession({ kind: "anonymous" });
    readAuthenticatedUserId.mockResolvedValue(null);

    const response = await getMarks();

    expect(response.status).toBe(401);
  });
});

describe("POST /api/v1/training/manage/marks", () => {
  it("la crea al final y responde 201 con la lista", async () => {
    const response = await postMark(JSON.stringify({ name: "Power clean" }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.marks.at(-1)).toMatchObject({
      id: NEW_MARK_ID,
      name: "Power clean",
    });
    expect(insertAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({ action: "training_mark.created" }),
    );
  });

  it("responde 409 a un nombre repetido", async () => {
    const response = await postMark(JSON.stringify({ name: "Back squat" }));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatchObject({
      code: "conflict",
      reason: "mark_name_taken",
    });
  });

  it.each([
    ["sin nombre", "{}"],
    ["con el nombre en blanco", JSON.stringify({ name: "  " })],
    ["con un campo de más", JSON.stringify({ name: "Clean", unit: "lb" })],
    ["que no es JSON", "nombre"],
  ])("responde 400 a un cuerpo %s", async (_label, body) => {
    const response = await postMark(body);

    expect(response.status).toBe(400);
    expect(insertAuditLogRow).not.toHaveBeenCalled();
  });

  it("a un Player le responde 403 sin crearla", async () => {
    givenCaller("Player");

    const response = await postMark(JSON.stringify({ name: "Power clean" }));

    expect(response.status).toBe(403);
    expect(marks).toHaveLength(2);
  });
});

describe("PATCH /api/v1/training/manage/marks/{markId}", () => {
  it("la renombra y responde la lista", async () => {
    const response = await patchMark(
      SQUAT_ID,
      JSON.stringify({ name: "Front squat" }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.marks[0]).toMatchObject({
      id: SQUAT_ID,
      name: "Front squat",
    });
  });

  it("responde 404 a una marca de otro club", async () => {
    const response = await patchMark(
      OTHER_CLUBS_MARK_ID,
      JSON.stringify({ name: "Front squat" }),
    );

    expect(response.status).toBe(404);
  });

  it("responde 404 a un id que no es un uuid", async () => {
    const response = await patchMark(
      "no-es-un-id",
      JSON.stringify({ name: "Front squat" }),
    );

    expect(response.status).toBe(404);
  });

  it("a un Committee le responde 403", async () => {
    givenCaller("Committee");

    const response = await patchMark(
      SQUAT_ID,
      JSON.stringify({ name: "Front squat" }),
    );

    expect(response.status).toBe(403);
  });
});

describe("DELETE /api/v1/training/manage/marks/{markId}", () => {
  it("responde 409 a una marca usada en una fila, aun confirmando", async () => {
    const response = await deleteMarkRequest(SQUAT_ID, "?confirm=true");

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatchObject({ reason: "mark_in_use" });
    expect(deleteMark).not.toHaveBeenCalled();
  });

  it("responde 409 con cuántos socios la registraron si no se confirma", async () => {
    const response = await deleteMarkRequest(BENCH_ID);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatchObject({
      reason: "mark_has_values",
      membersRecorded: 3,
    });
    expect(deleteMark).not.toHaveBeenCalled();
  });

  it("con ?confirm=true la borra con sus valores y responde la lista", async () => {
    const response = await deleteMarkRequest(BENCH_ID, "?confirm=true");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.marks.map((entry: { id: string }) => entry.id)).toEqual([
      SQUAT_ID,
    ]);
    expect(deleteMark).toHaveBeenCalledWith({
      clubId: CLUB_ID,
      markId: BENCH_ID,
    });
  });

  it("borra sin confirmar una sin usar y sin valores", async () => {
    marks = [
      mark(BENCH_ID, "Bench press", { routineRows: 0, membersRecorded: 0 }),
    ];

    const response = await deleteMarkRequest(BENCH_ID);

    expect(response.status).toBe(200);
  });

  it("responde 400 a un confirm que no es true ni false", async () => {
    const response = await deleteMarkRequest(BENCH_ID, "?confirm=si");

    expect(response.status).toBe(400);
    expect(deleteMark).not.toHaveBeenCalled();
  });

  it("responde 404 a una marca de otro club", async () => {
    const response = await deleteMarkRequest(
      OTHER_CLUBS_MARK_ID,
      "?confirm=true",
    );

    expect(response.status).toBe(404);
  });

  it("a un Player le responde 403 sin borrar", async () => {
    givenCaller("Player");

    const response = await deleteMarkRequest(BENCH_ID, "?confirm=true");

    expect(response.status).toBe(403);
    expect(deleteMark).not.toHaveBeenCalled();
  });
});
