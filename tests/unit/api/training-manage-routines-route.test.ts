import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import {
  TRAINING_MANAGE_ROUTINES_API_PATH,
  trainingManageExerciseLastDoseApiPath,
  trainingManageRoutineApiPath,
  trainingManageRoutineItemsApiPath,
} from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type {
  ClubRoutinesGateways,
  LastDose,
  ManagedRoutine,
} from "@/lib/training/club-routines";
import type { RoutineItemDraft } from "@/lib/training/routine-items";

/**
 * Las rutinas de Planificar por API (#905, RF-9, D8 a D10 del PRD de E35).
 * La petición entra por el proxy y sólo llega al handler si la frontera la
 * deja seguir, como en producción. El club vive en memoria; que guardar las
 * filas y borrar sean una transacción lo prueban la migración y la
 * integración.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const COACH_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const CYCLE_ID = "c1c1c1c1-0000-4000-8000-000000000001";
const OTHER_CLUBS_CYCLE_ID = "c1c1c1c1-0000-4000-8000-0000000000ff";
const STRENGTH_ID = "a0a0a0a0-0000-4000-8000-000000000001";
const SHARED_ID = "a0a0a0a0-0000-4000-8000-000000000002";
const NEW_ROUTINE_ID = "a0a0a0a0-0000-4000-8000-000000000003";
const OTHER_CLUBS_ROUTINE_ID = "a0a0a0a0-0000-4000-8000-0000000000ff";
const EXERCISE_ID = "e0e0e0e0-0000-4000-8000-000000000001";
const UNUSED_EXERCISE_ID = "e0e0e0e0-0000-4000-8000-000000000002";
const OTHER_CLUBS_EXERCISE_ID = "e0e0e0e0-0000-4000-8000-0000000000ff";
const MARK_ID = "1b2c3d4e-0000-4000-8000-000000000001";
const OTHER_CLUBS_MARK_ID = "1b2c3d4e-0000-4000-8000-0000000000ff";
const OWN_EXERCISES = [EXERCISE_ID, UNUSED_EXERCISE_ID];

const readSessionState = vi.fn();
const readAuthenticatedUserId = vi.fn();
const insertAuditLogRow = vi.fn();
const deleteRoutine = vi.fn();
const replaceItems = vi.fn();
let routines: ManagedRoutine[];

const LAST_DOSE: LastDose = {
  sets: 5,
  reps: "5",
  rest: "3'",
  load: { kind: "pct", markId: MARK_ID, pct: 75 },
};

function routine(
  id: string,
  options: Partial<ManagedRoutine> & { readonly name: string },
): ManagedRoutine {
  return {
    id,
    cycleId: null,
    colorIndex: 0,
    itemCount: 0,
    daysUsed: 0,
    ...options,
  };
}

function find(routineId: string): ManagedRoutine | null {
  return routines.find((candidate) => candidate.id === routineId) ?? null;
}

function clubRoutinesGateways(): ClubRoutinesGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Cora Coach",
        role: "Coach",
      }),
    },
    routines: {
      cycleExists: async ({ cycleId }) => cycleId === CYCLE_ID,
      listRoutines: async (_clubId, cycleId) =>
        routines.filter((candidate) => candidate.cycleId === cycleId),
      findRoutine: async ({ routineId }) => find(routineId),
      insertRoutine: async (row) => {
        routines.push(
          routine(NEW_ROUTINE_ID, {
            name: row.name,
            cycleId: row.cycleId,
            colorIndex: row.colorIndex,
          }),
        );
        return { kind: "created", routineId: NEW_ROUTINE_ID };
      },
      renameRoutine: async ({ routineId }, name) => {
        if (find(routineId) === null) {
          return false;
        }
        routines = routines.map((candidate) =>
          candidate.id === routineId ? { ...candidate, name } : candidate,
        );
        return true;
      },
      deleteRoutine: async (target, confirm) => {
        const existing = find(target.routineId);
        if (existing === null) {
          return { kind: "not_found" };
        }
        if (existing.daysUsed > 0 && !confirm) {
          return { kind: "in_use", daysUsed: existing.daysUsed };
        }
        deleteRoutine(target);
        routines = routines.filter(
          (candidate) => candidate.id !== target.routineId,
        );
        return { kind: "deleted", daysCleared: existing.daysUsed };
      },
      findUnknownReferences: async (_clubId, ids) => ({
        exerciseIds: ids.exerciseIds.filter(
          (id) => !OWN_EXERCISES.includes(id),
        ),
        markIds: ids.markIds.filter((id) => id !== MARK_ID),
      }),
      replaceItems: async (target, items: readonly RoutineItemDraft[]) => {
        if (find(target.routineId) === null) {
          return { kind: "not_found" };
        }
        replaceItems(target, items);
        return { kind: "replaced" };
      },
      exerciseVisible: async (_clubId, exerciseId) =>
        OWN_EXERCISES.includes(exerciseId),
      findLastDose: async (_clubId, exerciseId) =>
        exerciseId === EXERCISE_ID ? LAST_DOSE : null,
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

vi.mock("@/lib/training/supabase-club-routines-gateways", () => ({
  createSupabaseClubRoutinesGateways: () => ({
    kind: "ready",
    gateways: clubRoutinesGateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const listRoute = await import("@/app/api/v1/training/manage/routines/route");
const routineRoute =
  await import("@/app/api/v1/training/manage/routines/[routineId]/route");
const itemsRoute =
  await import("@/app/api/v1/training/manage/routines/[routineId]/items/route");
const lastDoseRoute =
  await import("@/app/api/v1/training/manage/exercises/[exerciseId]/last-dose/route");

function givenCaller(role: Role): void {
  const session: SessionState = {
    kind: "active",
    role,
    membershipCurrent: true,
  };
  readSessionState.mockResolvedValue(session);
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

function getRoutines(query: string): Promise<Response> {
  const request = new NextRequest(
    new URL(`${TRAINING_MANAGE_ROUTINES_API_PATH}${query}`, ORIGIN),
  );
  return throughProxy(request, () => listRoute.GET(request));
}

function postRoutine(body: unknown): Promise<Response> {
  const request = jsonRequest(
    TRAINING_MANAGE_ROUTINES_API_PATH,
    "POST",
    JSON.stringify(body),
  );
  return throughProxy(request, () => listRoute.POST(request));
}

function routineContext(routineId: string) {
  return { params: Promise.resolve({ routineId }) };
}

function patchRoutine(routineId: string, body: unknown): Promise<Response> {
  const request = jsonRequest(
    trainingManageRoutineApiPath(routineId),
    "PATCH",
    JSON.stringify(body),
  );
  return throughProxy(request, () =>
    routineRoute.PATCH(request, routineContext(routineId)),
  );
}

function deleteRoutineRequest(
  routineId: string,
  query = "",
): Promise<Response> {
  const request = new NextRequest(
    new URL(`${trainingManageRoutineApiPath(routineId)}${query}`, ORIGIN),
    { method: "DELETE" },
  );
  return throughProxy(request, () =>
    routineRoute.DELETE(request, routineContext(routineId)),
  );
}

function putItems(routineId: string, body: unknown): Promise<Response> {
  const request = jsonRequest(
    trainingManageRoutineItemsApiPath(routineId),
    "PUT",
    JSON.stringify(body),
  );
  return throughProxy(request, () =>
    itemsRoute.PUT(request, routineContext(routineId)),
  );
}

function getLastDose(exerciseId: string): Promise<Response> {
  const request = new NextRequest(
    new URL(trainingManageExerciseLastDoseApiPath(exerciseId), ORIGIN),
  );
  return throughProxy(request, () =>
    lastDoseRoute.GET(request, { params: Promise.resolve({ exerciseId }) }),
  );
}

function exerciseItem(load: unknown, exerciseId = EXERCISE_ID) {
  return { kind: "exercise", exerciseId, sets: 3, reps: "8", load };
}

beforeEach(() => {
  vi.clearAllMocks();
  readAuthenticatedUserId.mockResolvedValue(COACH_ID);
  givenCaller("Coach");
  routines = [
    routine(STRENGTH_ID, {
      name: "Strength A",
      cycleId: CYCLE_ID,
      itemCount: 4,
      daysUsed: 3,
    }),
    routine(SHARED_ID, { name: "Mobility", colorIndex: 1, itemCount: 2 }),
  ];
});

describe("GET /api/v1/training/manage/routines", () => {
  it("con ?cycle= devuelve las del ciclo y después las compartidas, con sus cuentas", async () => {
    const response = await getRoutines(`?cycle=${CYCLE_ID}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        routines: [
          {
            id: STRENGTH_ID,
            name: "Strength A",
            cycleId: CYCLE_ID,
            colorIndex: 0,
            itemCount: 4,
            daysUsed: 3,
          },
          {
            id: SHARED_ID,
            name: "Mobility",
            cycleId: null,
            colorIndex: 1,
            itemCount: 2,
            daysUsed: 0,
          },
        ],
      },
    });
  });

  it("con ?scope=shared devuelve sólo las compartidas", async () => {
    const response = await getRoutines("?scope=shared");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.routines.map((entry: { id: string }) => entry.id)).toEqual(
      [SHARED_ID],
    );
  });

  it.each([
    ["sin ciclo ni ámbito", ""],
    ["con ciclo y ámbito a la vez", `?cycle=${CYCLE_ID}&scope=shared`],
    ["con un ámbito que no existe", "?scope=all"],
  ])("responde 400 %s", async (_label, query) => {
    const response = await getRoutines(query);

    expect(response.status).toBe(400);
  });

  it.each([
    ["de otro club", OTHER_CLUBS_CYCLE_ID],
    ["que no es un uuid", "winter"],
  ])("responde 404 a un ciclo %s", async (_label, cycleId) => {
    const response = await getRoutines(`?cycle=${cycleId}`);

    expect(response.status).toBe(404);
  });

  it("no se guarda en ninguna caché", () => {
    expect(listRoute.dynamic).toBe("force-dynamic");
    expect(routineRoute.dynamic).toBe("force-dynamic");
    expect(itemsRoute.dynamic).toBe("force-dynamic");
    expect(lastDoseRoute.dynamic).toBe("force-dynamic");
  });
});

describe("POST /api/v1/training/manage/routines", () => {
  it("la crea en el ciclo con el color siguiente y responde 201", async () => {
    const response = await postRoutine({
      name: "Strength B",
      cycleId: CYCLE_ID,
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      data: {
        routine: {
          id: NEW_ROUTINE_ID,
          name: "Strength B",
          cycleId: CYCLE_ID,
          colorIndex: 1,
          itemCount: 0,
          daysUsed: 0,
        },
      },
    });
    expect(insertAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({ action: "training_routine.created" }),
    );
  });

  it.each([
    ["sin ciclo", { name: "Core" }],
    ["con el ciclo nulo", { name: "Core", cycleId: null }],
  ])("%s la crea compartida", async (_label, body) => {
    const response = await postRoutine(body);

    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.data.routine).toMatchObject({
      cycleId: null,
      colorIndex: 1,
    });
  });

  it("responde 404 a un ciclo de otro club", async () => {
    const response = await postRoutine({
      name: "Core",
      cycleId: OTHER_CLUBS_CYCLE_ID,
    });

    expect(response.status).toBe(404);
    expect(routines).toHaveLength(2);
  });

  it.each([
    ["sin nombre", {}],
    ["con el nombre en blanco", { name: "  " }],
    ["con un nombre de 61", { name: "x".repeat(61) }],
    ["con un campo de más", { name: "Core", colorIndex: 3 }],
  ])("responde 400 %s", async (_label, body) => {
    const response = await postRoutine(body);

    expect(response.status).toBe(400);
    expect(insertAuditLogRow).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/training/manage/routines/{routineId}", () => {
  it("la renombra y responde la rutina", async () => {
    const response = await patchRoutine(STRENGTH_ID, { name: "Heavy day" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.routine).toMatchObject({
      id: STRENGTH_ID,
      name: "Heavy day",
    });
    expect(insertAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({ action: "training_routine.renamed" }),
    );
  });

  it.each([
    ["vacío", ""],
    ["de más de 60", "x".repeat(61)],
  ])("responde 400 a un nombre %s", async (_label, name) => {
    const response = await patchRoutine(STRENGTH_ID, { name });

    expect(response.status).toBe(400);
  });

  it.each([
    ["de otro club", OTHER_CLUBS_ROUTINE_ID],
    ["que no es un uuid", "strength"],
  ])("responde 404 a una rutina %s", async (_label, routineId) => {
    const response = await patchRoutine(routineId, { name: "Heavy day" });

    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/v1/training/manage/routines/{routineId}", () => {
  it("sin confirmar responde 409 con cuántos días la usan", async () => {
    const response = await deleteRoutineRequest(STRENGTH_ID);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatchObject({
      code: "conflict",
      reason: "routine_in_use",
      daysUsed: 3,
    });
    expect(deleteRoutine).not.toHaveBeenCalled();
  });

  it("con ?confirm=true la borra y dice cuántos días quedaron en descanso", async () => {
    const response = await deleteRoutineRequest(STRENGTH_ID, "?confirm=true");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { routineId: STRENGTH_ID, daysCleared: 3 },
    });
    expect(deleteRoutine).toHaveBeenCalledWith({
      clubId: CLUB_ID,
      routineId: STRENGTH_ID,
    });
    expect(insertAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "training_routine.deleted",
        metadata: { daysCleared: 3 },
      }),
    );
  });

  it("borra sin confirmar una que no se usa", async () => {
    const response = await deleteRoutineRequest(SHARED_ID);

    expect(response.status).toBe(200);
  });

  it("responde 400 a un confirm que no es true ni false", async () => {
    const response = await deleteRoutineRequest(STRENGTH_ID, "?confirm=si");

    expect(response.status).toBe(400);
    expect(deleteRoutine).not.toHaveBeenCalled();
  });

  it("responde 404 a una rutina de otro club", async () => {
    const response = await deleteRoutineRequest(
      OTHER_CLUBS_ROUTINE_ID,
      "?confirm=true",
    );

    expect(response.status).toBe(404);
  });
});

describe("PUT /api/v1/training/manage/routines/{routineId}/items", () => {
  it("sustituye las filas en ese orden y responde lo guardado", async () => {
    const items = [
      { kind: "section", title: "Main" },
      exerciseItem({ kind: "week", markId: MARK_ID }),
      exerciseItem({ kind: "text", text: "Bodyweight" }, UNUSED_EXERCISE_ID),
    ];

    const response = await putItems(STRENGTH_ID, { items });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.routine).toMatchObject({ id: STRENGTH_ID, itemCount: 3 });
    expect(body.data.items.map((item: { kind: string }) => item.kind)).toEqual([
      "section",
      "exercise",
      "exercise",
    ]);
    expect(replaceItems).toHaveBeenCalledWith(
      { clubId: CLUB_ID, routineId: STRENGTH_ID },
      body.data.items,
    );
    expect(insertAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "training_routine.items_saved",
        metadata: { itemCount: 3 },
      }),
    );
  });

  it("guarda una sección sin ejercicio ni dosis", async () => {
    const response = await putItems(STRENGTH_ID, {
      items: [{ kind: "section", title: "Warm up" }],
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.items).toEqual([{ kind: "section", title: "Warm up" }]);
  });

  it.each([
    ["una sección con algo más", { kind: "section", title: "Main", sets: 3 }],
    ["pct sin marca", exerciseItem({ kind: "pct", pct: 70 })],
    ["pct sin porcentaje", exerciseItem({ kind: "pct", markId: MARK_ID })],
    ["week sin marca", exerciseItem({ kind: "week" })],
    ["text sin texto", exerciseItem({ kind: "text" })],
    [
      "una marca de otro club",
      exerciseItem({ kind: "week", markId: OTHER_CLUBS_MARK_ID }),
    ],
    [
      "un ejercicio de otro club",
      exerciseItem({ kind: "none" }, OTHER_CLUBS_EXERCISE_ID),
    ],
  ])("responde 400 a %s sin guardar", async (_label, item) => {
    const response = await putItems(STRENGTH_ID, { items: [item] });

    expect(response.status).toBe(400);
    expect(replaceItems).not.toHaveBeenCalled();
    expect(insertAuditLogRow).not.toHaveBeenCalled();
  });

  it("dice qué fila no vale", async () => {
    const response = await putItems(STRENGTH_ID, {
      items: [
        { kind: "section", title: "Main" },
        exerciseItem({ kind: "week" }),
      ],
    });

    const body = await response.json();
    expect(body.error).toMatchObject({ reason: "invalid_item", index: 1 });
  });

  it("responde 400 a más de 60 filas", async () => {
    const items = Array.from({ length: 61 }, () =>
      exerciseItem({ kind: "none" }),
    );

    const response = await putItems(STRENGTH_ID, { items });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatchObject({ reason: "too_many_items" });
    expect(replaceItems).not.toHaveBeenCalled();
  });

  it.each([
    ["sin la lista", {}],
    ["con la lista que no es una lista", { items: "Main" }],
  ])("responde 400 a un cuerpo %s", async (_label, body) => {
    const response = await putItems(STRENGTH_ID, body);

    expect(response.status).toBe(400);
  });

  it("responde 404 a una rutina de otro club", async () => {
    const response = await putItems(OTHER_CLUBS_ROUTINE_ID, {
      items: [{ kind: "section", title: "Main" }],
    });

    expect(response.status).toBe(404);
  });
});

describe("GET /api/v1/training/manage/exercises/{exerciseId}/last-dose", () => {
  it("devuelve la última dosis que el club usó con el ejercicio", async () => {
    const response = await getLastDose(EXERCISE_ID);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { dose: LAST_DOSE },
    });
  });

  it("devuelve nulo si nunca se usó", async () => {
    const response = await getLastDose(UNUSED_EXERCISE_ID);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { dose: null } });
  });

  it.each([
    ["de otro club", OTHER_CLUBS_EXERCISE_ID],
    ["que no es un uuid", "squat"],
  ])("responde 404 a un ejercicio %s", async (_label, exerciseId) => {
    const response = await getLastDose(exerciseId);

    expect(response.status).toBe(404);
  });
});

describe("quién puede llamar", () => {
  const calls: readonly (readonly [string, () => Promise<Response>])[] = [
    ["GET de las rutinas", () => getRoutines("?scope=shared")],
    ["POST de una rutina", () => postRoutine({ name: "Core" })],
    ["PATCH de una rutina", () => patchRoutine(STRENGTH_ID, { name: "X" })],
    ["DELETE de una rutina", () => deleteRoutineRequest(SHARED_ID)],
    [
      "PUT de las filas",
      () => putItems(STRENGTH_ID, { items: [{ kind: "section", title: "M" }] }),
    ],
    ["GET de la última dosis", () => getLastDose(EXERCISE_ID)],
  ];

  it.each(
    (["Player", "Committee"] as const).flatMap((role) =>
      calls.map(([label, call]) => [role, label, call] as const),
    ),
  )(
    "a un %s le responde 403 en el %s sin tocar nada",
    async (role, _label, call) => {
      givenCaller(role);

      const response = await call();

      expect(response.status).toBe(403);
      expect(replaceItems).not.toHaveBeenCalled();
      expect(deleteRoutine).not.toHaveBeenCalled();
      expect(insertAuditLogRow).not.toHaveBeenCalled();
    },
  );

  it.each<Role>(["Admin", "Coach"])(
    "a un %s le sirve las rutinas",
    async (role) => {
      givenCaller(role);

      const response = await getRoutines("?scope=shared");

      expect(response.status).toBe(200);
    },
  );

  it("sin sesión responde 401", async () => {
    readSessionState.mockResolvedValue({ kind: "anonymous" });
    readAuthenticatedUserId.mockResolvedValue(null);

    const response = await getRoutines("?scope=shared");

    expect(response.status).toBe(401);
  });
});
