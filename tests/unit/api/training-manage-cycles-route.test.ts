import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import {
  TRAINING_MANAGE_CYCLES_API_PATH,
  type TrainingCycleAction,
  trainingManageCycleActionApiPath,
  trainingManageCycleApiPath,
} from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type {
  ClubCycleRecord,
  ClubCyclesGateways,
  CycleDayRecord,
  CycleWeekRecord,
  RoutineScope,
} from "@/lib/training/club-cycles";

/**
 * Los ciclos de Planificar por API (#904, RF-7 y RF-8 del PRD de E35). La
 * petición entra por el proxy y sólo llega al handler si la frontera la deja
 * seguir, como en producción. El club vive en memoria; que activar y duplicar
 * sean una transacción lo prueban la migración y la integración.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const COACH_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const WINTER_ID = "c1c1c1c1-0000-4000-8000-000000000001";
const SUMMER_ID = "c1c1c1c1-0000-4000-8000-000000000002";
const NEW_CYCLE_ID = "c1c1c1c1-0000-4000-8000-000000000003";
const OTHER_CLUBS_CYCLE_ID = "c1c1c1c1-0000-4000-8000-0000000000ff";
const OWN_ROUTINE_ID = "a0a0a0a0-0000-4000-8000-000000000001";
const OTHER_CYCLES_ROUTINE_ID = "a0a0a0a0-0000-4000-8000-000000000003";

const readSessionState = vi.fn();
const readAuthenticatedUserId = vi.fn();
const insertAuditLogRow = vi.fn();
const setDay = vi.fn();
const copyWeekOne = vi.fn();
let cycles: ClubCycleRecord[];
let days: CycleDayRecord[];
let weeks: CycleWeekRecord[];

function cycle(
  id: string,
  overrides: Partial<ClubCycleRecord> = {},
): ClubCycleRecord {
  return {
    id,
    name: "Winter",
    status: "draft",
    weeks: 4,
    startDate: "2026-11-16",
    event: { name: "Nationals", date: "2026-12-13" },
    ownRoutines: 1,
    ...overrides,
  };
}

const ROUTINE_SCOPES: Readonly<Record<string, RoutineScope>> = {
  [OWN_ROUTINE_ID]: { kind: "cycle", cycleId: WINTER_ID },
  [OTHER_CYCLES_ROUTINE_ID]: { kind: "cycle", cycleId: SUMMER_ID },
};

function replaceCycle(cycleId: string, change: Partial<ClubCycleRecord>) {
  cycles = cycles.map((candidate) =>
    candidate.id === cycleId ? { ...candidate, ...change } : candidate,
  );
}

function clubCyclesGateways(): ClubCyclesGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Cora Coach",
        role: "Coach",
      }),
    },
    cycles: {
      listCycles: async () => [...cycles],
      findCycle: async ({ cycleId }) =>
        cycles.find((candidate) => candidate.id === cycleId) ?? null,
      readCyclePlan: async () => ({ weeks: [...weeks], days: [...days] }),
      insertCycle: async (fields) => {
        cycles.push(cycle(NEW_CYCLE_ID, { ...fields, ownRoutines: 0 }));
        return NEW_CYCLE_ID;
      },
      updateCycle: async ({ cycleId }, fields) => {
        replaceCycle(cycleId, fields);
        days = days.filter((day) => day.weekNo <= fields.weeks);
      },
      activateCycle: async ({ cycleId }) => {
        replaceCycle(WINTER_ID, { status: "archived" });
        replaceCycle(cycleId, { status: "active" });
        return { archivedCycleId: WINTER_ID };
      },
      archiveCycle: async ({ cycleId }) => {
        replaceCycle(cycleId, { status: "archived" });
      },
      deleteCycle: async ({ cycleId }) => {
        const target = cycles.find((candidate) => candidate.id === cycleId);
        if (target === undefined) {
          return { kind: "missing" };
        }
        if (target.status === "active") {
          return { kind: "active" };
        }
        cycles = cycles.filter((candidate) => candidate.id !== cycleId);
        return {
          kind: "deleted",
          status: target.status,
          routinesDeleted: target.ownRoutines,
        };
      },
      duplicateCycle: async (_target, copy) => {
        cycles.push(cycle(NEW_CYCLE_ID, { name: copy.name }));
        return { cycleId: NEW_CYCLE_ID, routinesCopied: 1 };
      },
      findRoutineScope: async (_clubId, routineId) =>
        ROUTINE_SCOPES[routineId] ?? { kind: "missing" },
      setDay: async (_target, day) => {
        setDay(day);
      },
      saveWeek: async (_target, week) => {
        weeks = [...weeks.filter((w) => w.weekNo !== week.weekNo), week];
      },
      copyWeekOne: async (_target, targetWeeks) => {
        copyWeekOne(targetWeeks);
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

vi.mock("@/lib/training/supabase-club-cycles-gateways", () => ({
  createSupabaseClubCyclesGateways: () => ({
    kind: "ready",
    gateways: clubCyclesGateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const listRoute = await import("@/app/api/v1/training/manage/cycles/route");
const cycleRoute =
  await import("@/app/api/v1/training/manage/cycles/[cycleId]/route");
const actionRoutes = {
  activate:
    await import("@/app/api/v1/training/manage/cycles/[cycleId]/activate/route"),
  archive:
    await import("@/app/api/v1/training/manage/cycles/[cycleId]/archive/route"),
  duplicate:
    await import("@/app/api/v1/training/manage/cycles/[cycleId]/duplicate/route"),
  "copy-week-one":
    await import("@/app/api/v1/training/manage/cycles/[cycleId]/copy-week-one/route"),
} as const;
const weeksRoute =
  await import("@/app/api/v1/training/manage/cycles/[cycleId]/weeks/route");
const daysRoute =
  await import("@/app/api/v1/training/manage/cycles/[cycleId]/days/route");

type PostAction = keyof typeof actionRoutes;

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

function jsonRequest(path: string, method: string, body: unknown): NextRequest {
  return new NextRequest(new URL(path, ORIGIN), {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function context(cycleId: string) {
  return { params: Promise.resolve({ cycleId }) };
}

function getCycles(): Promise<Response> {
  const request = new NextRequest(
    new URL(TRAINING_MANAGE_CYCLES_API_PATH, ORIGIN),
  );
  return throughProxy(request, () => listRoute.GET(request));
}

function postCycle(body: unknown): Promise<Response> {
  const request = jsonRequest(TRAINING_MANAGE_CYCLES_API_PATH, "POST", body);
  return throughProxy(request, () => listRoute.POST(request));
}

function getCycle(cycleId: string): Promise<Response> {
  const request = new NextRequest(
    new URL(trainingManageCycleApiPath(cycleId), ORIGIN),
  );
  return throughProxy(request, () => cycleRoute.GET(request, context(cycleId)));
}

function patchCycle(cycleId: string, body: unknown): Promise<Response> {
  const request = jsonRequest(
    trainingManageCycleApiPath(cycleId),
    "PATCH",
    body,
  );
  return throughProxy(request, () =>
    cycleRoute.PATCH(request, context(cycleId)),
  );
}

function deleteCycle(cycleId: string): Promise<Response> {
  const request = new NextRequest(
    new URL(trainingManageCycleApiPath(cycleId), ORIGIN),
    { method: "DELETE" },
  );
  return throughProxy(request, () =>
    cycleRoute.DELETE(request, context(cycleId)),
  );
}

function postAction(cycleId: string, action: PostAction): Promise<Response> {
  const request = new NextRequest(
    new URL(trainingManageCycleActionApiPath(cycleId, action), ORIGIN),
    { method: "POST" },
  );
  return throughProxy(request, () =>
    actionRoutes[action].POST(request, context(cycleId)),
  );
}

function putPart(
  cycleId: string,
  part: Extract<TrainingCycleAction, "weeks" | "days">,
  body: unknown,
): Promise<Response> {
  const request = jsonRequest(
    trainingManageCycleActionApiPath(cycleId, part),
    "PUT",
    body,
  );
  const route = part === "weeks" ? weeksRoute : daysRoute;
  return throughProxy(request, () => route.PUT(request, context(cycleId)));
}

async function dataOf(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json()) as { data: Record<string, unknown> };
  return body.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  readAuthenticatedUserId.mockResolvedValue(COACH_ID);
  givenCaller("Coach");
  cycles = [
    cycle(WINTER_ID, { status: "active" }),
    cycle(SUMMER_ID, { name: "Summer", event: null, ownRoutines: 0 }),
  ];
  days = [];
  weeks = [];
});

describe("GET /api/v1/training/manage/cycles", () => {
  it("devuelve los ciclos del club con estado, fechas, semanas y rutinas propias", async () => {
    const response = await getCycles();

    expect(response.status).toBe(200);
    await expect(dataOf(response)).resolves.toEqual({
      cycles: [
        {
          id: WINTER_ID,
          name: "Winter",
          status: "active",
          weeks: 4,
          startDate: "2026-11-16",
          event: { name: "Nationals", date: "2026-12-13" },
          ownRoutines: 1,
        },
        {
          id: SUMMER_ID,
          name: "Summer",
          status: "draft",
          weeks: 4,
          startDate: "2026-11-16",
          event: null,
          ownRoutines: 0,
        },
      ],
    });
  });

  it("no se guarda en ninguna caché", () => {
    for (const route of [
      listRoute,
      cycleRoute,
      weeksRoute,
      daysRoute,
      ...Object.values(actionRoutes),
    ]) {
      expect(route.dynamic).toBe("force-dynamic");
    }
  });

  it("sin sesión responde 401", async () => {
    givenSession({ kind: "anonymous" });
    readAuthenticatedUserId.mockResolvedValue(null);

    const response = await getCycles();

    expect(response.status).toBe(401);
  });
});

describe.each<Role>(["Player", "Committee"])("un %s", (role) => {
  beforeEach(() => {
    givenCaller(role);
  });

  it("recibe 403 en la lista y al crear", async () => {
    const list = await getCycles();
    const created = await postCycle({
      name: "Winter",
      weeks: 4,
      schedule: { kind: "start", startDate: "2026-11-16" },
    });

    expect([list.status, created.status]).toEqual([403, 403]);
  });

  it("recibe 403 al leer, cambiar o actuar sobre un ciclo", async () => {
    const statuses = [
      (await getCycle(WINTER_ID)).status,
      (await patchCycle(WINTER_ID, { name: "X" })).status,
      (await postAction(WINTER_ID, "activate")).status,
      (await postAction(WINTER_ID, "archive")).status,
      (await deleteCycle(SUMMER_ID)).status,
      (await postAction(WINTER_ID, "duplicate")).status,
      (await postAction(WINTER_ID, "copy-week-one")).status,
      (
        await putPart(WINTER_ID, "weeks", {
          weekNo: 1,
          note: null,
          dose: null,
        })
      ).status,
      (
        await putPart(WINTER_ID, "days", {
          weekNo: 1,
          weekday: 0,
          slot: 1,
          routineId: null,
        })
      ).status,
    ];

    expect(statuses).toEqual(Array(statuses.length).fill(403));
    expect(insertAuditLogRow).not.toHaveBeenCalled();
  });
});

describe("un ciclo de otro club", () => {
  it("responde 404 en cada ruta", async () => {
    const statuses = [
      (await getCycle(OTHER_CLUBS_CYCLE_ID)).status,
      (await patchCycle(OTHER_CLUBS_CYCLE_ID, { name: "X" })).status,
      (await postAction(OTHER_CLUBS_CYCLE_ID, "activate")).status,
      (await postAction(OTHER_CLUBS_CYCLE_ID, "archive")).status,
      (await deleteCycle(OTHER_CLUBS_CYCLE_ID)).status,
      (await postAction(OTHER_CLUBS_CYCLE_ID, "duplicate")).status,
      (await postAction(OTHER_CLUBS_CYCLE_ID, "copy-week-one")).status,
      (
        await putPart(OTHER_CLUBS_CYCLE_ID, "weeks", {
          weekNo: 1,
          note: null,
          dose: null,
        })
      ).status,
      (
        await putPart(OTHER_CLUBS_CYCLE_ID, "days", {
          weekNo: 1,
          weekday: 0,
          slot: 1,
          routineId: null,
        })
      ).status,
    ];

    expect(statuses).toEqual(Array(statuses.length).fill(404));
  });

  it("un id que no es un uuid también es 404", async () => {
    const response = await getCycle("no-es-un-id");

    expect(response.status).toBe(404);
  });
});

describe("GET /api/v1/training/manage/cycles/{id}", () => {
  it("devuelve el ciclo, cada semana con nota y dosis, y la cuadrícula", async () => {
    weeks = [
      {
        weekNo: 1,
        note: "Camp",
        dose: {
          sets: 4,
          reps: "5",
          intensity: { kind: "text", text: "RPE 7" },
        },
      },
    ];
    days = [{ weekNo: 1, weekday: 2, slot: 1, routineId: OWN_ROUTINE_ID }];

    const response = await getCycle(WINTER_ID);

    expect(response.status).toBe(200);
    const data = await dataOf(response);
    expect(data.cycle).toMatchObject({ id: WINTER_ID, weeks: 4 });
    expect(data.weeks).toHaveLength(4);
    expect((data.weeks as unknown[])[0]).toEqual(weeks[0]);
    expect(data.days).toEqual(days);
  });
});

describe("POST /api/v1/training/manage/cycles", () => {
  it("crea un borrador con el inicio calculado desde el evento y responde 201", async () => {
    const response = await postCycle({
      name: "Nationals block",
      weeks: 16,
      schedule: {
        kind: "event",
        eventName: "Nationals",
        eventDate: "2026-12-13",
      },
    });

    expect(response.status).toBe(201);
    const data = await dataOf(response);
    expect(data.cycle).toMatchObject({
      id: NEW_CYCLE_ID,
      status: "draft",
      startDate: "2026-08-24",
    });
    expect(insertAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({ action: "training_cycle.created" }),
    );
  });

  it("sin evento lleva la fecha de inicio a su lunes", async () => {
    const response = await postCycle({
      name: "Off season",
      weeks: 8,
      schedule: { kind: "start", startDate: "2026-10-29" },
    });

    expect(response.status).toBe(201);
    expect((await dataOf(response)).cycle).toMatchObject({
      startDate: "2026-10-26",
      event: null,
    });
  });

  it.each([
    ["un nombre vacío", { name: " ", weeks: 4 }],
    ["un nombre de 81", { name: "x".repeat(81), weeks: 4 }],
    ["0 semanas", { name: "Winter", weeks: 0 }],
    ["53 semanas", { name: "Winter", weeks: 53 }],
    ["semanas con decimales", { name: "Winter", weeks: 4.5 }],
  ])("con %s responde 400", async (_case, fields) => {
    const response = await postCycle({
      ...fields,
      schedule: { kind: "start", startDate: "2026-10-26" },
    });

    expect(response.status).toBe(400);
  });

  it.each([
    ["una fecha imposible", { kind: "start", startDate: "2026-02-30" }],
    ["un evento sin fecha", { kind: "event", eventName: "Cup" }],
    ["otro tipo de inicio", { kind: "soon" }],
  ])("con %s responde 400", async (_case, schedule) => {
    const response = await postCycle({ name: "Winter", weeks: 4, schedule });

    expect(response.status).toBe(400);
  });
});

describe("PATCH /api/v1/training/manage/cycles/{id}", () => {
  it("baja las semanas sin días que perder", async () => {
    const response = await patchCycle(WINTER_ID, { weeks: 2 });

    expect(response.status).toBe(200);
    expect((await dataOf(response)).cycle).toMatchObject({ weeks: 2 });
  });

  it("con días con rutina en las semanas que sobran responde 409 con cuántos", async () => {
    days = [
      { weekNo: 3, weekday: 0, slot: 1, routineId: OWN_ROUTINE_ID },
      { weekNo: 4, weekday: 6, slot: 1, routineId: OWN_ROUTINE_ID },
    ];

    const response = await patchCycle(WINTER_ID, { weeks: 2 });

    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      error: { reason: string; daysRemoved: number };
    };
    expect(body.error).toMatchObject({
      reason: "cycle_days_would_be_removed",
      daysRemoved: 2,
    });
  });

  it("con confirmRemoval: true las quita", async () => {
    days = [{ weekNo: 3, weekday: 0, slot: 1, routineId: OWN_ROUTINE_ID }];

    const response = await patchCycle(WINTER_ID, {
      weeks: 2,
      confirmRemoval: true,
    });

    expect(response.status).toBe(200);
    expect((await dataOf(response)).days).toEqual([]);
  });

  it("con un campo que no existe responde 400", async () => {
    const response = await patchCycle(WINTER_ID, { status: "active" });

    expect(response.status).toBe(400);
  });

  it("con 53 semanas responde 400", async () => {
    const response = await patchCycle(WINTER_ID, { weeks: 53 });

    expect(response.status).toBe(400);
  });
});

describe("las acciones de un ciclo", () => {
  it("activar pasa el borrador a activo y archiva el anterior", async () => {
    const response = await postAction(SUMMER_ID, "activate");

    expect(response.status).toBe(200);
    const data = await dataOf(response);
    expect(data.cycles).toEqual([
      expect.objectContaining({ id: WINTER_ID, status: "archived" }),
      expect.objectContaining({ id: SUMMER_ID, status: "active" }),
    ]);
    expect(insertAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({ action: "training_cycle.activated" }),
    );
  });

  it("archivar pasa el ciclo a archivado", async () => {
    const response = await postAction(SUMMER_ID, "archive");

    expect(response.status).toBe(200);
    expect((await dataOf(response)).cycles).toContainEqual(
      expect.objectContaining({ id: SUMMER_ID, status: "archived" }),
    );
    expect(insertAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({ action: "training_cycle.archived" }),
    );
  });

  it("duplicar crea '{nombre} (copy)' y dice cuántas rutinas copió", async () => {
    const response = await postAction(WINTER_ID, "duplicate");

    expect(response.status).toBe(200);
    const data = await dataOf(response);
    expect(data).toMatchObject({
      duplicatedCycleId: NEW_CYCLE_ID,
      routinesCopied: 1,
    });
    expect(data.cycles).toContainEqual(
      expect.objectContaining({ id: NEW_CYCLE_ID, name: "Winter (copy)" }),
    );
  });

  it("copiar la semana 1 la pasa de la 2 a la N − 2", async () => {
    replaceCycle(WINTER_ID, { weeks: 5 });

    const response = await postAction(WINTER_ID, "copy-week-one");

    expect(response.status).toBe(200);
    expect(copyWeekOne).toHaveBeenCalledWith([2, 3]);
  });

  it("copiar la semana 1 de un ciclo de menos de 4 semanas responde 400", async () => {
    replaceCycle(WINTER_ID, { weeks: 3 });

    const response = await postAction(WINTER_ID, "copy-week-one");

    expect(response.status).toBe(400);
    expect(copyWeekOne).not.toHaveBeenCalled();
  });

  it("no responde a GET", async () => {
    const request = new NextRequest(
      new URL(trainingManageCycleActionApiPath(WINTER_ID, "activate"), ORIGIN),
    );

    const response = await throughProxy(request, () =>
      actionRoutes.activate.GET(request),
    );

    expect(response.status).toBe(405);
  });
});

describe("DELETE /api/v1/training/manage/cycles/[cycleId]", () => {
  it("borra un borrador y responde la lista como al archivar", async () => {
    const response = await deleteCycle(SUMMER_ID);

    expect(response.status).toBe(200);
    expect((await dataOf(response)).cycles).toEqual([
      expect.objectContaining({ id: WINTER_ID, status: "active" }),
    ]);
  });

  it("borra un archivado y lo anota con nombre, estado y rutinas propias", async () => {
    cycles = [
      cycle(WINTER_ID, { status: "archived", ownRoutines: 2 }),
      cycle(SUMMER_ID, { status: "active" }),
    ];

    const response = await deleteCycle(WINTER_ID);

    expect(response.status).toBe(200);
    expect(insertAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "training_cycle.deleted",
        entity_id: WINTER_ID,
        metadata: { name: "Winter", status: "archived", routinesDeleted: 2 },
      }),
    );
  });

  it("el activo responde 409 cycle_is_active y no borra nada", async () => {
    const response = await deleteCycle(WINTER_ID);

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { reason: string } };
    expect(body.error.reason).toBe("cycle_is_active");
    expect(cycles.map(({ id }) => id)).toEqual([WINTER_ID, SUMMER_ID]);
    expect(insertAuditLogRow).not.toHaveBeenCalled();
  });

  it("un ciclo que ya no existe responde 404", async () => {
    await deleteCycle(SUMMER_ID);

    const again = await deleteCycle(SUMMER_ID);

    expect(again.status).toBe(404);
  });
});

describe("PUT /api/v1/training/manage/cycles/{id}/days", () => {
  it("guarda una rutina del ciclo en una ranura", async () => {
    const response = await putPart(WINTER_ID, "days", {
      weekNo: 2,
      weekday: 4,
      slot: 2,
      routineId: OWN_ROUTINE_ID,
    });

    expect(response.status).toBe(200);
    expect(setDay).toHaveBeenCalledWith({
      weekNo: 2,
      weekday: 4,
      slot: 2,
      routineId: OWN_ROUTINE_ID,
    });
    expect(insertAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({ action: "training_cycle.day_updated" }),
    );
  });

  it("con rutina nula vacía la ranura", async () => {
    const response = await putPart(WINTER_ID, "days", {
      weekNo: 2,
      weekday: 4,
      slot: 1,
      routineId: null,
    });

    expect(response.status).toBe(200);
    expect(setDay).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 1, routineId: null }),
    );
  });

  it("una rutina de otro ciclo que no es compartida responde 400", async () => {
    const response = await putPart(WINTER_ID, "days", {
      weekNo: 2,
      weekday: 4,
      slot: 1,
      routineId: OTHER_CYCLES_ROUTINE_ID,
    });

    expect(response.status).toBe(400);
    expect(setDay).not.toHaveBeenCalled();
  });

  it.each([
    ["la ranura 3", { weekNo: 1, weekday: 0, slot: 3 }],
    ["la semana 5 de un ciclo de 4", { weekNo: 5, weekday: 0, slot: 1 }],
    ["el día 7", { weekNo: 1, weekday: 7, slot: 1 }],
  ])("con %s responde 400", async (_case, day) => {
    const response = await putPart(WINTER_ID, "days", {
      ...day,
      routineId: OWN_ROUTINE_ID,
    });

    expect(response.status).toBe(400);
  });
});

describe("PUT /api/v1/training/manage/cycles/{id}/weeks", () => {
  it("guarda la nota y la dosis de la semana", async () => {
    const week = {
      weekNo: 2,
      note: "Test 3RM",
      dose: { sets: 4, reps: "5", intensity: { kind: "pct", pct: 80 } },
    };

    const response = await putPart(WINTER_ID, "weeks", week);

    expect(response.status).toBe(200);
    expect(((await dataOf(response)).weeks as unknown[])[1]).toEqual(week);
    expect(insertAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({ action: "training_cycle.week_updated" }),
    );
  });

  it.each([
    ["una nota de 141", { note: "n".repeat(141), dose: null }],
    [
      "100 series",
      {
        note: null,
        dose: { sets: 100, reps: null, intensity: { kind: "none" } },
      },
    ],
    [
      "repeticiones de 21",
      {
        note: null,
        dose: { sets: 3, reps: "r".repeat(21), intensity: { kind: "none" } },
      },
    ],
    [
      "un 151 %",
      {
        note: null,
        dose: { sets: 3, reps: null, intensity: { kind: "pct", pct: 151 } },
      },
    ],
    [
      "un texto de 21",
      {
        note: null,
        dose: {
          sets: 3,
          reps: null,
          intensity: { kind: "text", text: "t".repeat(21) },
        },
      },
    ],
    [
      "otra intensidad",
      {
        note: null,
        dose: { sets: 3, reps: null, intensity: { kind: "rpe", rpe: 7 } },
      },
    ],
  ])("con %s responde 400", async (_case, fields) => {
    const response = await putPart(WINTER_ID, "weeks", {
      weekNo: 1,
      ...fields,
    });

    expect(response.status).toBe(400);
  });
});
