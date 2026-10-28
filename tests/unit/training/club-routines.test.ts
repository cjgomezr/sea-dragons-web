import { beforeEach, describe, expect, it } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import { CycleNotFoundError } from "@/lib/training/club-cycles";
import { ExerciseNotFoundError } from "@/lib/training/club-exercises";
import {
  type ClubRoutinesGateways,
  type LastDose,
  type ManagedRoutine,
  ROUTINE_PALETTE_SIZE,
  RoutineInUseError,
  RoutineItemReferenceError,
  RoutineNotFoundError,
  RoutineValidationError,
  createClubRoutine,
  deleteClubRoutine,
  findLastExerciseDose,
  listClubRoutines,
  nextRoutineColorIndex,
  renameClubRoutine,
  saveRoutineItems,
} from "@/lib/training/club-routines";
import {
  type RoutineItemDraft,
  RoutineItemsValidationError,
} from "@/lib/training/routine-items";
import { TrainingPlannerForbiddenError } from "@/lib/training/training-planner";

/**
 * Las rutinas en Planificar (#905, RF-9, D8 a D10 del PRD de E35), contra un
 * club en memoria. Que las cuentas, el borrado con la ranura 2 y la
 * sustitución de filas vayan en una transacción lo prueba la migración.
 */

const COACH_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const CYCLE_ID = "c1c1c1c1-0000-4000-8000-000000000001";
const OTHER_CLUBS_CYCLE_ID = "c1c1c1c1-0000-4000-8000-0000000000ff";
const STRENGTH_ID = "a0a0a0a0-0000-4000-8000-000000000001";
const SHARED_ID = "a0a0a0a0-0000-4000-8000-000000000002";
const NEW_ROUTINE_ID = "a0a0a0a0-0000-4000-8000-000000000003";
const UNKNOWN_ROUTINE_ID = "a0a0a0a0-0000-4000-8000-0000000000ff";
const EXERCISE_ID = "e0e0e0e0-0000-4000-8000-000000000001";
const OTHER_CLUBS_EXERCISE_ID = "e0e0e0e0-0000-4000-8000-0000000000ff";
const MARK_ID = "1b2c3d4e-0000-4000-8000-000000000001";
const OTHER_CLUBS_MARK_ID = "1b2c3d4e-0000-4000-8000-0000000000ff";

let callerRole: Role;
let routines: ManagedRoutine[];
let savedItems: Map<string, readonly RoutineItemDraft[]>;
let lastDoses: Map<string, LastDose>;
let auditRows: AuditLogInsertRow[];
let deletedWithConfirm: boolean[];
let referenceRace: boolean;

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

function gateways(): ClubRoutinesGateways {
  const find = (routineId: string) =>
    routines.find((candidate) => candidate.id === routineId) ?? null;
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Cora Coach",
        role: callerRole,
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
        const existing = find(routineId);
        if (existing === null) {
          return false;
        }
        routines = routines.map((candidate) =>
          candidate.id === routineId ? { ...candidate, name } : candidate,
        );
        return true;
      },
      deleteRoutine: async ({ routineId }, confirm) => {
        const existing = find(routineId);
        if (existing === null) {
          return { kind: "not_found" };
        }
        if (existing.daysUsed > 0 && !confirm) {
          return { kind: "in_use", daysUsed: existing.daysUsed };
        }
        deletedWithConfirm.push(confirm);
        routines = routines.filter((candidate) => candidate.id !== routineId);
        return { kind: "deleted", daysCleared: existing.daysUsed };
      },
      findUnknownReferences: async (_clubId, ids) => ({
        exerciseIds: ids.exerciseIds.filter((id) => id !== EXERCISE_ID),
        markIds: ids.markIds.filter((id) => id !== MARK_ID),
      }),
      replaceItems: async ({ routineId }, items) => {
        if (find(routineId) === null) {
          return { kind: "not_found" };
        }
        if (referenceRace) {
          return { kind: "stale_reference" };
        }
        savedItems.set(routineId, items);
        return { kind: "replaced" };
      },
      exerciseVisible: async (_clubId, exerciseId) =>
        exerciseId === EXERCISE_ID,
      findLastDose: async (_clubId, exerciseId) =>
        lastDoses.get(exerciseId) ?? null,
    },
    audit: {
      insertAuditLogRow: async (row) => {
        auditRows.push(row);
        return { error: null };
      },
    },
  };
}

beforeEach(() => {
  callerRole = "Coach";
  routines = [
    routine(STRENGTH_ID, {
      name: "Strength A",
      cycleId: CYCLE_ID,
      colorIndex: 0,
      itemCount: 4,
      daysUsed: 3,
    }),
    routine(SHARED_ID, { name: "Mobility", colorIndex: 0, itemCount: 2 }),
  ];
  savedItems = new Map();
  lastDoses = new Map();
  auditRows = [];
  deletedWithConfirm = [];
  referenceRace = false;
});

describe("nextRoutineColorIndex", () => {
  it.each([
    [0, 0],
    [1, 1],
    [5, 5],
    [6, 0],
    [13, 1],
  ])("con %i rutinas en el ámbito da el color %i", (count, expected) => {
    expect(nextRoutineColorIndex(count)).toBe(expected);
  });

  it("la paleta tiene seis colores", () => {
    expect(ROUTINE_PALETTE_SIZE).toBe(6);
  });
});

describe("listClubRoutines", () => {
  it("de un ciclo devuelve las suyas y después las compartidas", async () => {
    const result = await listClubRoutines(gateways(), {
      callerId: COACH_ID,
      scope: { kind: "cycle", cycleId: CYCLE_ID },
    });

    expect(result.routines.map((entry) => entry.id)).toEqual([
      STRENGTH_ID,
      SHARED_ID,
    ]);
    expect(result.routines[0]).toEqual({
      id: STRENGTH_ID,
      name: "Strength A",
      cycleId: CYCLE_ID,
      colorIndex: 0,
      itemCount: 4,
      daysUsed: 3,
    });
  });

  it("con el ámbito compartido devuelve sólo las compartidas", async () => {
    const result = await listClubRoutines(gateways(), {
      callerId: COACH_ID,
      scope: { kind: "shared" },
    });

    expect(result.routines.map((entry) => entry.id)).toEqual([SHARED_ID]);
  });

  it("rechaza un ciclo de otro club", async () => {
    await expect(
      listClubRoutines(gateways(), {
        callerId: COACH_ID,
        scope: { kind: "cycle", cycleId: OTHER_CLUBS_CYCLE_ID },
      }),
    ).rejects.toThrow(CycleNotFoundError);
  });

  it.each<Role>(["Player", "Committee"])("rechaza a un %s", async (role) => {
    callerRole = role;

    await expect(
      listClubRoutines(gateways(), {
        callerId: COACH_ID,
        scope: { kind: "shared" },
      }),
    ).rejects.toThrow(TrainingPlannerForbiddenError);
  });
});

describe("createClubRoutine", () => {
  it("la crea en el ciclo con el color siguiente al de las que ya hay", async () => {
    const created = await createClubRoutine(gateways(), {
      callerId: COACH_ID,
      cycleId: CYCLE_ID,
      name: "  Strength B ",
    });

    expect(created).toEqual({
      routine: {
        id: NEW_ROUTINE_ID,
        name: "Strength B",
        cycleId: CYCLE_ID,
        colorIndex: 1,
        itemCount: 0,
        daysUsed: 0,
      },
    });
  });

  it("sin ciclo la crea compartida, contando sólo las compartidas", async () => {
    routines.push(
      routine("a0a0a0a0-0000-4000-8000-000000000010", {
        name: "Swim",
        colorIndex: 1,
      }),
    );

    const created = await createClubRoutine(gateways(), {
      callerId: COACH_ID,
      cycleId: null,
      name: "Core",
    });

    expect(created.routine).toMatchObject({ cycleId: null, colorIndex: 2 });
  });

  it("vuelve al primer color con seis en el ámbito", async () => {
    routines = Array.from({ length: 6 }, (_, index) =>
      routine(`a0a0a0a0-0000-4000-8000-00000000002${index}`, {
        name: `R${index}`,
      }),
    );

    const created = await createClubRoutine(gateways(), {
      callerId: COACH_ID,
      cycleId: null,
      name: "Seventh",
    });

    expect(created.routine.colorIndex).toBe(0);
  });

  it("deja la creación en la bitácora", async () => {
    await createClubRoutine(gateways(), {
      callerId: COACH_ID,
      cycleId: CYCLE_ID,
      name: "Strength B",
    });

    expect(auditRows).toEqual([
      expect.objectContaining({
        action: "training_routine.created",
        entity_type: "training_routine",
        entity_id: NEW_ROUTINE_ID,
        club_id: CLUB_ID,
      }),
    ]);
  });

  it("rechaza un ciclo de otro club", async () => {
    await expect(
      createClubRoutine(gateways(), {
        callerId: COACH_ID,
        cycleId: OTHER_CLUBS_CYCLE_ID,
        name: "Strength B",
      }),
    ).rejects.toThrow(CycleNotFoundError);
    expect(routines).toHaveLength(2);
  });

  it.each([
    ["vacío", "   ", "name_required"],
    ["de 61", "x".repeat(61), "name_too_long"],
  ])("rechaza un nombre %s", async (_label, name, code) => {
    await expect(
      createClubRoutine(gateways(), {
        callerId: COACH_ID,
        cycleId: null,
        name,
      }),
    ).rejects.toThrow(expect.objectContaining({ code }));
    expect(auditRows).toEqual([]);
  });

  it("rechaza a un Player", async () => {
    callerRole = "Player";

    await expect(
      createClubRoutine(gateways(), {
        callerId: COACH_ID,
        cycleId: null,
        name: "Core",
      }),
    ).rejects.toThrow(TrainingPlannerForbiddenError);
  });
});

describe("renameClubRoutine", () => {
  it("la renombra, la devuelve con sus cuentas y lo anota", async () => {
    const renamed = await renameClubRoutine(gateways(), {
      callerId: COACH_ID,
      routineId: STRENGTH_ID,
      name: "Heavy day",
    });

    expect(renamed.routine).toMatchObject({
      id: STRENGTH_ID,
      name: "Heavy day",
      daysUsed: 3,
    });
    expect(auditRows).toEqual([
      expect.objectContaining({ action: "training_routine.renamed" }),
    ]);
  });

  it.each([
    ["vacío", ""],
    ["de 61", "x".repeat(61)],
  ])("rechaza un nombre %s", async (_label, name) => {
    await expect(
      renameClubRoutine(gateways(), {
        callerId: COACH_ID,
        routineId: STRENGTH_ID,
        name,
      }),
    ).rejects.toThrow(RoutineValidationError);
  });

  it("rechaza una rutina de otro club", async () => {
    await expect(
      renameClubRoutine(gateways(), {
        callerId: COACH_ID,
        routineId: UNKNOWN_ROUTINE_ID,
        name: "Heavy day",
      }),
    ).rejects.toThrow(RoutineNotFoundError);
  });
});

describe("deleteClubRoutine", () => {
  it("sin confirmar rechaza una usada y dice en cuántos días", async () => {
    await expect(
      deleteClubRoutine(gateways(), {
        callerId: COACH_ID,
        routineId: STRENGTH_ID,
        confirm: false,
      }),
    ).rejects.toThrow(expect.objectContaining({ daysUsed: 3 }));
    expect(routines).toHaveLength(2);
    expect(auditRows).toEqual([]);
  });

  it("es un RoutineInUseError", async () => {
    await expect(
      deleteClubRoutine(gateways(), {
        callerId: COACH_ID,
        routineId: STRENGTH_ID,
        confirm: false,
      }),
    ).rejects.toThrow(RoutineInUseError);
  });

  it("confirmando la borra, dice cuántos días quedaron en descanso y lo anota", async () => {
    const result = await deleteClubRoutine(gateways(), {
      callerId: COACH_ID,
      routineId: STRENGTH_ID,
      confirm: true,
    });

    expect(result).toEqual({ routineId: STRENGTH_ID, daysCleared: 3 });
    expect(deletedWithConfirm).toEqual([true]);
    expect(auditRows).toEqual([
      expect.objectContaining({
        action: "training_routine.deleted",
        entity_id: STRENGTH_ID,
        metadata: { daysCleared: 3 },
      }),
    ]);
  });

  it("borra sin confirmar una que no se usa", async () => {
    const result = await deleteClubRoutine(gateways(), {
      callerId: COACH_ID,
      routineId: SHARED_ID,
      confirm: false,
    });

    expect(result).toEqual({ routineId: SHARED_ID, daysCleared: 0 });
  });

  it("rechaza una rutina de otro club", async () => {
    await expect(
      deleteClubRoutine(gateways(), {
        callerId: COACH_ID,
        routineId: UNKNOWN_ROUTINE_ID,
        confirm: true,
      }),
    ).rejects.toThrow(RoutineNotFoundError);
  });
});

describe("saveRoutineItems", () => {
  const items = [
    { kind: "section", title: "Main" },
    {
      kind: "exercise",
      exerciseId: EXERCISE_ID,
      sets: 5,
      reps: "5",
      load: { kind: "pct", markId: MARK_ID, pct: 75 },
    },
  ];

  it("sustituye las filas en ese orden y devuelve la rutina con lo guardado", async () => {
    const result = await saveRoutineItems(gateways(), {
      callerId: COACH_ID,
      routineId: STRENGTH_ID,
      items,
    });

    const expectedItems = [
      { kind: "section", title: "Main" },
      {
        kind: "exercise",
        exerciseId: EXERCISE_ID,
        sets: 5,
        reps: "5",
        rest: null,
        note: null,
        load: { kind: "pct", markId: MARK_ID, pct: 75 },
      },
    ];
    expect(savedItems.get(STRENGTH_ID)).toEqual(expectedItems);
    expect(result).toEqual({
      routine: expect.objectContaining({ id: STRENGTH_ID, itemCount: 2 }),
      items: expectedItems,
    });
  });

  it("deja en la bitácora cuántas filas guardó", async () => {
    await saveRoutineItems(gateways(), {
      callerId: COACH_ID,
      routineId: STRENGTH_ID,
      items,
    });

    expect(auditRows).toEqual([
      expect.objectContaining({
        action: "training_routine.items_saved",
        entity_id: STRENGTH_ID,
        metadata: { itemCount: 2 },
      }),
    ]);
  });

  it("rechaza una fila que no vale sin guardar nada", async () => {
    await expect(
      saveRoutineItems(gateways(), {
        callerId: COACH_ID,
        routineId: STRENGTH_ID,
        items: [{ kind: "section", title: "Main", sets: 3 }],
      }),
    ).rejects.toThrow(RoutineItemsValidationError);
    expect(savedItems.size).toBe(0);
  });

  it.each([
    [
      "un ejercicio de otro club",
      {
        kind: "exercise",
        exerciseId: OTHER_CLUBS_EXERCISE_ID,
        load: { kind: "none" },
      },
    ],
    [
      "una marca de otro club",
      {
        kind: "exercise",
        exerciseId: EXERCISE_ID,
        load: { kind: "week", markId: OTHER_CLUBS_MARK_ID },
      },
    ],
  ])("rechaza %s sin guardar nada", async (_label, item) => {
    await expect(
      saveRoutineItems(gateways(), {
        callerId: COACH_ID,
        routineId: STRENGTH_ID,
        items: [item],
      }),
    ).rejects.toThrow(RoutineItemReferenceError);
    expect(savedItems.size).toBe(0);
    expect(auditRows).toEqual([]);
  });

  it("rechaza una marca o un ejercicio que se borró entretanto", async () => {
    referenceRace = true;

    await expect(
      saveRoutineItems(gateways(), {
        callerId: COACH_ID,
        routineId: STRENGTH_ID,
        items,
      }),
    ).rejects.toThrow(RoutineItemReferenceError);
  });

  it("rechaza una rutina de otro club", async () => {
    await expect(
      saveRoutineItems(gateways(), {
        callerId: COACH_ID,
        routineId: UNKNOWN_ROUTINE_ID,
        items,
      }),
    ).rejects.toThrow(RoutineNotFoundError);
  });

  it("rechaza a un Committee", async () => {
    callerRole = "Committee";

    await expect(
      saveRoutineItems(gateways(), {
        callerId: COACH_ID,
        routineId: STRENGTH_ID,
        items,
      }),
    ).rejects.toThrow(TrainingPlannerForbiddenError);
  });
});

describe("findLastExerciseDose", () => {
  it("devuelve la última dosis que el club usó con ese ejercicio", async () => {
    const dose: LastDose = {
      sets: 4,
      reps: "6",
      rest: "2'",
      load: { kind: "week", markId: MARK_ID },
    };
    lastDoses.set(EXERCISE_ID, dose);

    const result = await findLastExerciseDose(gateways(), {
      callerId: COACH_ID,
      exerciseId: EXERCISE_ID,
    });

    expect(result).toEqual({ dose });
  });

  it("devuelve nulo si el club nunca lo usó", async () => {
    const result = await findLastExerciseDose(gateways(), {
      callerId: COACH_ID,
      exerciseId: EXERCISE_ID,
    });

    expect(result).toEqual({ dose: null });
  });

  it("rechaza un ejercicio de otro club", async () => {
    await expect(
      findLastExerciseDose(gateways(), {
        callerId: COACH_ID,
        exerciseId: OTHER_CLUBS_EXERCISE_ID,
      }),
    ).rejects.toThrow(ExerciseNotFoundError);
  });

  it("rechaza a un Player", async () => {
    callerRole = "Player";

    await expect(
      findLastExerciseDose(gateways(), {
        callerId: COACH_ID,
        exerciseId: EXERCISE_ID,
      }),
    ).rejects.toThrow(TrainingPlannerForbiddenError);
  });
});
