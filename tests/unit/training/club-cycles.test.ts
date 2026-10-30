import { beforeEach, describe, expect, it } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import {
  type ClubCycleRecord,
  type ClubCyclesGateways,
  type CycleDayRecord,
  type CycleFields,
  type CycleWeekRecord,
  type RoutineScope,
  CycleIsActiveError,
  CycleNotFoundError,
  activateManagedCycle,
  archiveManagedCycle,
  copyManagedCycleWeekOne,
  createManagedCycle,
  deleteManagedCycle,
  duplicateManagedCycle,
  listManagedCycles,
  readManagedCycle,
  saveManagedCycleWeek,
  setManagedCycleDay,
  updateManagedCycle,
} from "@/lib/training/club-cycles";
import {
  CYCLE_NAME_MAX_LENGTH,
  CycleValidationError,
} from "@/lib/training/club-cycle-input";
import { TrainingPlannerForbiddenError } from "@/lib/training/training-planner";

/**
 * Los ciclos en Planificar (#904, RF-7, RF-8 y D5 a D8 del PRD de E35),
 * contra un club en memoria. Que activar archive el anterior en una sola
 * transacción, que duplicar copie y reapunte y que la ranura 2 suba a la 1 lo
 * prueban la migración y el test de integración.
 */

const COACH_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const WINTER_ID = "c1c1c1c1-0000-4000-8000-000000000001";
const SUMMER_ID = "c1c1c1c1-0000-4000-8000-000000000002";
const NEW_CYCLE_ID = "c1c1c1c1-0000-4000-8000-000000000003";
const UNKNOWN_CYCLE_ID = "c1c1c1c1-0000-4000-8000-0000000000ff";
const OWN_ROUTINE_ID = "a0a0a0a0-0000-4000-8000-000000000001";
const SHARED_ROUTINE_ID = "a0a0a0a0-0000-4000-8000-000000000002";
const OTHER_CYCLES_ROUTINE_ID = "a0a0a0a0-0000-4000-8000-000000000003";
const UNKNOWN_ROUTINE_ID = "a0a0a0a0-0000-4000-8000-0000000000ff";

let callerRole: Role;
let cycles: ClubCycleRecord[];
let days: CycleDayRecord[];
let weeks: CycleWeekRecord[];
let auditRows: AuditLogInsertRow[];
let updates: CycleFields[];
let savedDays: unknown[];
let copiedWeeks: (readonly number[])[];
let duplicateNames: string[];

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
    ownRoutines: 2,
    ...overrides,
  };
}

const ROUTINE_SCOPES: Readonly<Record<string, RoutineScope>> = {
  [OWN_ROUTINE_ID]: { kind: "cycle", cycleId: WINTER_ID },
  [SHARED_ROUTINE_ID]: { kind: "shared" },
  [OTHER_CYCLES_ROUTINE_ID]: { kind: "cycle", cycleId: SUMMER_ID },
};

function findCycle(cycleId: string): ClubCycleRecord | null {
  return cycles.find((candidate) => candidate.id === cycleId) ?? null;
}

function gateways(): ClubCyclesGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Cora Coach",
        role: callerRole,
      }),
    },
    cycles: {
      listCycles: async (clubId) => (clubId === CLUB_ID ? [...cycles] : []),
      findCycle: async ({ clubId, cycleId }) =>
        clubId === CLUB_ID ? findCycle(cycleId) : null,
      readCyclePlan: async () => ({ weeks: [...weeks], days: [...days] }),
      insertCycle: async (fields) => {
        cycles.push(cycle(NEW_CYCLE_ID, { ...fields, ownRoutines: 0 }));
        return NEW_CYCLE_ID;
      },
      updateCycle: async ({ cycleId }, fields) => {
        updates.push(fields);
        cycles = cycles.map((candidate) =>
          candidate.id === cycleId ? { ...candidate, ...fields } : candidate,
        );
      },
      activateCycle: async ({ cycleId }) => {
        const previous = cycles.find(
          (candidate) => candidate.status === "active",
        );
        cycles = cycles.map((candidate) => {
          if (candidate.id === cycleId) {
            return { ...candidate, status: "active" };
          }
          return candidate.status === "active"
            ? { ...candidate, status: "archived" }
            : candidate;
        });
        return {
          archivedCycleId: previous === undefined ? null : previous.id,
        };
      },
      archiveCycle: async ({ cycleId }) => {
        cycles = cycles.map((candidate) =>
          candidate.id === cycleId
            ? { ...candidate, status: "archived" }
            : candidate,
        );
      },
      deleteCycle: async ({ cycleId }) => {
        const target = findCycle(cycleId);
        if (target === null) {
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
      duplicateCycle: async ({ cycleId }, copy) => {
        duplicateNames.push(copy.name);
        const source = findCycle(cycleId);
        if (source === null) {
          throw new Error("duplicar un ciclo que no existe");
        }
        cycles.push({ ...source, id: NEW_CYCLE_ID, name: copy.name });
        return { cycleId: NEW_CYCLE_ID, routinesCopied: source.ownRoutines };
      },
      findRoutineScope: async (_clubId, routineId) =>
        ROUTINE_SCOPES[routineId] ?? { kind: "missing" },
      setDay: async (_target, day) => {
        savedDays.push(day);
      },
      saveWeek: async (_target, week) => {
        weeks = [...weeks.filter((w) => w.weekNo !== week.weekNo), week];
      },
      copyWeekOne: async (_target, targetWeeks) => {
        copiedWeeks.push(targetWeeks);
      },
    },
    audit: {
      insertAuditLogRow: async (row) => {
        auditRows.push(row);
        return { error: null };
      },
    },
  };
}

function day(weekNo: number, weekday: number, slot: 1 | 2): CycleDayRecord {
  return { weekNo, weekday, slot, routineId: OWN_ROUTINE_ID };
}

function lastAudit(): AuditLogInsertRow | undefined {
  return auditRows.at(-1);
}

beforeEach(() => {
  callerRole = "Coach";
  cycles = [
    cycle(WINTER_ID, { status: "active" }),
    cycle(SUMMER_ID, { name: "Summer", event: null }),
  ];
  days = [];
  weeks = [];
  auditRows = [];
  updates = [];
  savedDays = [];
  copiedWeeks = [];
  duplicateNames = [];
});

describe("listManagedCycles", () => {
  it("devuelve todos los ciclos del club con su estado y sus rutinas propias", async () => {
    const result = await listManagedCycles(gateways(), COACH_ID);

    expect(
      result.cycles.map(({ id, status, ownRoutines }) => ({
        id,
        status,
        ownRoutines,
      })),
    ).toEqual([
      { id: WINTER_ID, status: "active", ownRoutines: 2 },
      { id: SUMMER_ID, status: "draft", ownRoutines: 2 },
    ]);
  });

  it.each<Role>(["Player", "Committee"])("a un %s lo rechaza", async (role) => {
    callerRole = role;

    await expect(listManagedCycles(gateways(), COACH_ID)).rejects.toThrow(
      TrainingPlannerForbiddenError,
    );
  });
});

describe("readManagedCycle", () => {
  it("devuelve cada semana del ciclo, con su nota y dosis o vacía, y la cuadrícula", async () => {
    weeks = [
      {
        weekNo: 2,
        note: "Camp",
        dose: { sets: 4, reps: "5", intensity: { kind: "pct", pct: 80 } },
      },
    ];
    days = [day(1, 0, 1), day(1, 0, 2)];

    const detail = await readManagedCycle(gateways(), {
      callerId: COACH_ID,
      cycleId: WINTER_ID,
    });

    expect(detail.cycle.id).toBe(WINTER_ID);
    expect(detail.weeks).toEqual([
      { weekNo: 1, note: null, dose: null },
      {
        weekNo: 2,
        note: "Camp",
        dose: { sets: 4, reps: "5", intensity: { kind: "pct", pct: 80 } },
      },
      { weekNo: 3, note: null, dose: null },
      { weekNo: 4, note: null, dose: null },
    ]);
    expect(detail.days).toEqual([day(1, 0, 1), day(1, 0, 2)]);
  });

  it("un ciclo que no es del club no existe", async () => {
    await expect(
      readManagedCycle(gateways(), {
        callerId: COACH_ID,
        cycleId: UNKNOWN_CYCLE_ID,
      }),
    ).rejects.toThrow(CycleNotFoundError);
  });
});

describe("createManagedCycle", () => {
  it("con evento nace en borrador y empieza N − 1 semanas antes del lunes del evento", async () => {
    const detail = await createManagedCycle(gateways(), {
      callerId: COACH_ID,
      input: {
        name: "  Nationals 2026 ",
        weeks: 16,
        schedule: {
          kind: "event",
          eventName: " Nationals ",
          eventDate: "2026-12-13",
        },
      },
    });

    expect(detail.cycle).toMatchObject({
      id: NEW_CYCLE_ID,
      name: "Nationals 2026",
      status: "draft",
      weeks: 16,
      startDate: "2026-08-24",
      event: { name: "Nationals", date: "2026-12-13" },
    });
    expect(lastAudit()).toMatchObject({
      action: "training_cycle.created",
      entity_type: "training_cycle",
      entity_id: NEW_CYCLE_ID,
    });
  });

  it("sin evento lleva la fecha de inicio a su lunes", async () => {
    const detail = await createManagedCycle(gateways(), {
      callerId: COACH_ID,
      input: {
        name: "Off season",
        weeks: 8,
        schedule: { kind: "start", startDate: "2026-10-29" },
      },
    });

    expect(detail.cycle).toMatchObject({
      startDate: "2026-10-26",
      event: null,
    });
  });

  it.each([
    ["   ", "name_required"],
    ["x".repeat(CYCLE_NAME_MAX_LENGTH + 1), "name_too_long"],
  ])("rechaza el nombre %j", async (name, code) => {
    await expect(
      createManagedCycle(gateways(), {
        callerId: COACH_ID,
        input: {
          name,
          weeks: 8,
          schedule: { kind: "start", startDate: "2026-10-26" },
        },
      }),
    ).rejects.toMatchObject({ code });
  });

  it("acepta un nombre de 80 caracteres", async () => {
    const detail = await createManagedCycle(gateways(), {
      callerId: COACH_ID,
      input: {
        name: "x".repeat(CYCLE_NAME_MAX_LENGTH),
        weeks: 8,
        schedule: { kind: "start", startDate: "2026-10-26" },
      },
    });

    expect(detail.cycle.name).toHaveLength(CYCLE_NAME_MAX_LENGTH);
  });

  it.each([0, 53])("rechaza %i semanas", async (cycleWeeks) => {
    await expect(
      createManagedCycle(gateways(), {
        callerId: COACH_ID,
        input: {
          name: "Winter",
          weeks: cycleWeeks,
          schedule: { kind: "start", startDate: "2026-10-26" },
        },
      }),
    ).rejects.toMatchObject({ code: "weeks_out_of_range" });
  });

  it("rechaza un evento sin nombre", async () => {
    await expect(
      createManagedCycle(gateways(), {
        callerId: COACH_ID,
        input: {
          name: "Winter",
          weeks: 8,
          schedule: { kind: "event", eventName: " ", eventDate: "2026-12-13" },
        },
      }),
    ).rejects.toThrow(CycleValidationError);
  });

  it("a un Player lo rechaza sin crear nada", async () => {
    callerRole = "Player";

    await expect(
      createManagedCycle(gateways(), {
        callerId: COACH_ID,
        input: {
          name: "Winter",
          weeks: 8,
          schedule: { kind: "start", startDate: "2026-10-26" },
        },
      }),
    ).rejects.toThrow(TrainingPlannerForbiddenError);
    expect(cycles).toHaveLength(2);
  });
});

describe("updateManagedCycle", () => {
  it("renombra sin tocar semanas ni fechas", async () => {
    const detail = await updateManagedCycle(gateways(), {
      callerId: COACH_ID,
      cycleId: WINTER_ID,
      changes: { name: "Winter block" },
      confirmRemoval: false,
    });

    expect(detail.cycle).toMatchObject({
      name: "Winter block",
      weeks: 4,
      startDate: "2026-11-16",
    });
    expect(lastAudit()).toMatchObject({
      action: "training_cycle.updated",
      entity_id: WINTER_ID,
    });
  });

  it("con evento, cambiar las semanas mueve el inicio para que el evento siga en la última", async () => {
    const detail = await updateManagedCycle(gateways(), {
      callerId: COACH_ID,
      cycleId: WINTER_ID,
      changes: { weeks: 6 },
      confirmRemoval: false,
    });

    expect(detail.cycle.startDate).toBe("2026-11-02");
  });

  it("sin evento, cambiar las semanas deja el inicio", async () => {
    const detail = await updateManagedCycle(gateways(), {
      callerId: COACH_ID,
      cycleId: SUMMER_ID,
      changes: { weeks: 6 },
      confirmRemoval: false,
    });

    expect(detail.cycle.startDate).toBe("2026-11-16");
  });

  it("cambiar la fecha del evento mueve el ciclo con él", async () => {
    const detail = await updateManagedCycle(gateways(), {
      callerId: COACH_ID,
      cycleId: WINTER_ID,
      changes: {
        schedule: {
          kind: "event",
          eventName: "Nationals",
          eventDate: "2026-12-20",
        },
      },
      confirmRemoval: false,
    });

    expect(detail.cycle.startDate).toBe("2026-11-23");
  });

  it("quitar el evento deja el ciclo en la fecha de inicio dada", async () => {
    const detail = await updateManagedCycle(gateways(), {
      callerId: COACH_ID,
      cycleId: WINTER_ID,
      changes: { schedule: { kind: "start", startDate: "2026-11-18" } },
      confirmRemoval: false,
    });

    expect(detail.cycle).toMatchObject({
      startDate: "2026-11-16",
      event: null,
    });
  });

  it("bajar las semanas con días planificados en las que sobran pide confirmar y cuenta los días", async () => {
    days = [day(1, 0, 1), day(3, 2, 1), day(3, 2, 2), day(4, 5, 1)];

    await expect(
      updateManagedCycle(gateways(), {
        callerId: COACH_ID,
        cycleId: WINTER_ID,
        changes: { weeks: 2 },
        confirmRemoval: false,
      }),
    ).rejects.toMatchObject({
      name: "CycleDaysWouldBeRemovedError",
      daysRemoved: 2,
    });
    expect(updates).toEqual([]);
  });

  it("con la confirmación, baja las semanas", async () => {
    days = [day(3, 2, 1)];

    const detail = await updateManagedCycle(gateways(), {
      callerId: COACH_ID,
      cycleId: WINTER_ID,
      changes: { weeks: 2 },
      confirmRemoval: true,
    });

    expect(detail.cycle.weeks).toBe(2);
    expect(lastAudit()?.metadata).toEqual({ daysRemoved: 1 });
  });

  it("bajar las semanas sin días en las que sobran no pide confirmar", async () => {
    days = [day(1, 0, 1)];

    const detail = await updateManagedCycle(gateways(), {
      callerId: COACH_ID,
      cycleId: WINTER_ID,
      changes: { weeks: 2 },
      confirmRemoval: false,
    });

    expect(detail.cycle.weeks).toBe(2);
  });

  it("rechaza semanas fuera de 1 a 52", async () => {
    await expect(
      updateManagedCycle(gateways(), {
        callerId: COACH_ID,
        cycleId: WINTER_ID,
        changes: { weeks: 53 },
        confirmRemoval: false,
      }),
    ).rejects.toMatchObject({ code: "weeks_out_of_range" });
  });

  it("un ciclo que no es del club no existe", async () => {
    await expect(
      updateManagedCycle(gateways(), {
        callerId: COACH_ID,
        cycleId: UNKNOWN_CYCLE_ID,
        changes: { name: "Nope" },
        confirmRemoval: false,
      }),
    ).rejects.toThrow(CycleNotFoundError);
  });
});

describe("activateManagedCycle", () => {
  it("activa el borrador, archiva el anterior y lo anota", async () => {
    const result = await activateManagedCycle(gateways(), {
      callerId: COACH_ID,
      cycleId: SUMMER_ID,
    });

    expect(result.cycles.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: WINTER_ID, status: "archived" },
      { id: SUMMER_ID, status: "active" },
    ]);
    expect(lastAudit()).toMatchObject({
      action: "training_cycle.activated",
      entity_id: SUMMER_ID,
      metadata: { archivedCycleId: WINTER_ID },
    });
  });

  it("un ciclo que no es del club no existe", async () => {
    await expect(
      activateManagedCycle(gateways(), {
        callerId: COACH_ID,
        cycleId: UNKNOWN_CYCLE_ID,
      }),
    ).rejects.toThrow(CycleNotFoundError);
  });
});

describe("archiveManagedCycle", () => {
  it("lo archiva y lo anota", async () => {
    const result = await archiveManagedCycle(gateways(), {
      callerId: COACH_ID,
      cycleId: WINTER_ID,
    });

    expect(result.cycles[0]?.status).toBe("archived");
    expect(lastAudit()).toMatchObject({
      action: "training_cycle.archived",
      entity_id: WINTER_ID,
    });
  });
});

describe("deleteManagedCycle", () => {
  it("borra un borrador y responde los ciclos que quedan", async () => {
    const result = await deleteManagedCycle(gateways(), {
      callerId: COACH_ID,
      cycleId: SUMMER_ID,
    });

    expect(result.cycles.map(({ id }) => id)).toEqual([WINTER_ID]);
  });

  it("borra un archivado", async () => {
    cycles = [cycle(WINTER_ID, { status: "archived" })];

    const result = await deleteManagedCycle(gateways(), {
      callerId: COACH_ID,
      cycleId: WINTER_ID,
    });

    expect(result.cycles).toEqual([]);
  });

  it("rechaza el activo y no lo borra ni lo anota", async () => {
    await expect(
      deleteManagedCycle(gateways(), {
        callerId: COACH_ID,
        cycleId: WINTER_ID,
      }),
    ).rejects.toThrow(CycleIsActiveError);
    expect(findCycle(WINTER_ID)).not.toBeNull();
    expect(auditRows).toEqual([]);
  });

  it("un ciclo que no es del club no existe", async () => {
    await expect(
      deleteManagedCycle(gateways(), {
        callerId: COACH_ID,
        cycleId: UNKNOWN_CYCLE_ID,
      }),
    ).rejects.toThrow(CycleNotFoundError);
  });

  it("anota el nombre, el estado que tenía y las rutinas propias borradas", async () => {
    cycles = [cycle(SUMMER_ID, { name: "Summer", ownRoutines: 3 })];

    await deleteManagedCycle(gateways(), {
      callerId: COACH_ID,
      cycleId: SUMMER_ID,
    });

    expect(lastAudit()).toMatchObject({
      action: "training_cycle.deleted",
      entity_type: "training_cycle",
      entity_id: SUMMER_ID,
      metadata: { name: "Summer", status: "draft", routinesDeleted: 3 },
    });
  });

  it("un Player no puede borrar", async () => {
    callerRole = "Player";

    await expect(
      deleteManagedCycle(gateways(), {
        callerId: COACH_ID,
        cycleId: SUMMER_ID,
      }),
    ).rejects.toThrow(TrainingPlannerForbiddenError);
    expect(findCycle(SUMMER_ID)).not.toBeNull();
  });
});

describe("duplicateManagedCycle", () => {
  it("nace '{nombre} (copy)' y dice cuántas rutinas copió", async () => {
    const result = await duplicateManagedCycle(gateways(), {
      callerId: COACH_ID,
      cycleId: WINTER_ID,
    });

    expect(duplicateNames).toEqual(["Winter (copy)"]);
    expect(result.duplicatedCycleId).toBe(NEW_CYCLE_ID);
    expect(result.routinesCopied).toBe(2);
    expect(lastAudit()).toMatchObject({
      action: "training_cycle.duplicated",
      entity_id: NEW_CYCLE_ID,
      metadata: { sourceCycleId: WINTER_ID, routinesCopied: 2 },
    });
  });

  it("recorta un nombre largo para que la copia quepa en 80 caracteres", async () => {
    cycles = [cycle(WINTER_ID, { name: "x".repeat(CYCLE_NAME_MAX_LENGTH) })];

    await duplicateManagedCycle(gateways(), {
      callerId: COACH_ID,
      cycleId: WINTER_ID,
    });

    const [name] = duplicateNames;
    expect(name).toHaveLength(CYCLE_NAME_MAX_LENGTH);
    expect(name?.endsWith(" (copy)")).toBe(true);
  });

  it("un ciclo que no es del club no existe", async () => {
    await expect(
      duplicateManagedCycle(gateways(), {
        callerId: COACH_ID,
        cycleId: UNKNOWN_CYCLE_ID,
      }),
    ).rejects.toThrow(CycleNotFoundError);
  });
});

describe("setManagedCycleDay", () => {
  function setDay(dayInput: {
    readonly weekNo: number;
    readonly weekday: number;
    readonly slot: 1 | 2;
    readonly routineId: string | null;
  }) {
    return setManagedCycleDay(gateways(), {
      callerId: COACH_ID,
      cycleId: WINTER_ID,
      day: dayInput,
    });
  }

  it.each([
    ["propia", OWN_ROUTINE_ID],
    ["compartida", SHARED_ROUTINE_ID],
  ])("guarda una rutina %s y lo anota", async (_scope, routineId) => {
    await setDay({ weekNo: 2, weekday: 3, slot: 1, routineId });

    expect(savedDays).toEqual([{ weekNo: 2, weekday: 3, slot: 1, routineId }]);
    expect(lastAudit()).toMatchObject({
      action: "training_cycle.day_updated",
      entity_id: WINTER_ID,
      metadata: { weekNo: 2, weekday: 3, slot: 1 },
    });
  });

  it("con rutina nula vacía la ranura", async () => {
    await setDay({ weekNo: 2, weekday: 3, slot: 2, routineId: null });

    expect(savedDays).toEqual([
      { weekNo: 2, weekday: 3, slot: 2, routineId: null },
    ]);
  });

  it.each([
    ["de otro ciclo", OTHER_CYCLES_ROUTINE_ID],
    ["que no existe en el club", UNKNOWN_ROUTINE_ID],
  ])("rechaza una rutina %s", async (_case, routineId) => {
    await expect(
      setDay({ weekNo: 2, weekday: 3, slot: 1, routineId }),
    ).rejects.toMatchObject({ code: "routine_not_allowed" });
    expect(savedDays).toEqual([]);
  });

  it.each([0, 5])("rechaza la semana %i de un ciclo de 4", async (weekNo) => {
    await expect(
      setDay({ weekNo, weekday: 0, slot: 1, routineId: OWN_ROUTINE_ID }),
    ).rejects.toMatchObject({ code: "week_out_of_range" });
  });

  it.each([-1, 7])("rechaza el día %i", async (weekday) => {
    await expect(
      setDay({ weekNo: 1, weekday, slot: 1, routineId: OWN_ROUTINE_ID }),
    ).rejects.toMatchObject({ code: "weekday_out_of_range" });
  });
});

describe("saveManagedCycleWeek", () => {
  function saveWeek(week: Parameters<typeof saveManagedCycleWeek>[1]["week"]) {
    return saveManagedCycleWeek(gateways(), {
      callerId: COACH_ID,
      cycleId: WINTER_ID,
      week,
    });
  }

  it("guarda la nota y la dosis, y lo anota", async () => {
    const detail = await saveWeek({
      weekNo: 3,
      note: " Test 3RM ",
      dose: { sets: 4, reps: " 5 ", intensity: { kind: "pct", pct: 82.5 } },
    });

    expect(detail.weeks[2]).toEqual({
      weekNo: 3,
      note: "Test 3RM",
      dose: { sets: 4, reps: "5", intensity: { kind: "pct", pct: 82.5 } },
    });
    expect(lastAudit()).toMatchObject({
      action: "training_cycle.week_updated",
      metadata: { weekNo: 3 },
    });
  });

  it("una intensidad de texto se guarda recortada", async () => {
    const detail = await saveWeek({
      weekNo: 1,
      note: null,
      dose: {
        sets: 3,
        reps: null,
        intensity: { kind: "text", text: " RPE 7 " },
      },
    });

    expect(detail.weeks[0]?.dose).toEqual({
      sets: 3,
      reps: null,
      intensity: { kind: "text", text: "RPE 7" },
    });
  });

  it("textos vacíos y una dosis sin nada dejan la semana sin nota ni dosis", async () => {
    const detail = await saveWeek({
      weekNo: 1,
      note: "  ",
      dose: { sets: null, reps: " ", intensity: { kind: "none" } },
    });

    expect(detail.weeks[0]).toEqual({ weekNo: 1, note: null, dose: null });
  });

  it("acepta los límites: nota de 140, 1 y 99 series, 1 y 150 %", async () => {
    await expect(
      saveWeek({
        weekNo: 1,
        note: "n".repeat(140),
        dose: {
          sets: 99,
          reps: "r".repeat(20),
          intensity: { kind: "pct", pct: 150 },
        },
      }),
    ).resolves.toBeDefined();
    await expect(
      saveWeek({
        weekNo: 1,
        note: null,
        dose: { sets: 1, reps: null, intensity: { kind: "pct", pct: 1 } },
      }),
    ).resolves.toBeDefined();
  });

  it.each([
    ["una nota de 141", { note: "n".repeat(141) }, "note_too_long"],
    [
      "0 series",
      { dose: { sets: 0, reps: null, intensity: { kind: "none" } } },
      "dose_sets_out_of_range",
    ],
    [
      "100 series",
      { dose: { sets: 100, reps: null, intensity: { kind: "none" } } },
      "dose_sets_out_of_range",
    ],
    [
      "repeticiones de 21",
      { dose: { sets: 3, reps: "r".repeat(21), intensity: { kind: "none" } } },
      "dose_reps_too_long",
    ],
    [
      "un 0,5 %",
      { dose: { sets: 3, reps: null, intensity: { kind: "pct", pct: 0.5 } } },
      "dose_pct_out_of_range",
    ],
    [
      "un 151 %",
      { dose: { sets: 3, reps: null, intensity: { kind: "pct", pct: 151 } } },
      "dose_pct_out_of_range",
    ],
    [
      "un 80,25 %",
      { dose: { sets: 3, reps: null, intensity: { kind: "pct", pct: 80.25 } } },
      "dose_pct_out_of_range",
    ],
    [
      "un texto vacío",
      { dose: { sets: 3, reps: null, intensity: { kind: "text", text: " " } } },
      "dose_text_required",
    ],
    [
      "un texto de 21",
      {
        dose: {
          sets: 3,
          reps: null,
          intensity: { kind: "text", text: "t".repeat(21) },
        },
      },
      "dose_text_too_long",
    ],
  ] as const)("rechaza %s", async (_case, override, code) => {
    await expect(
      saveWeek({ weekNo: 1, note: null, dose: null, ...override }),
    ).rejects.toMatchObject({ code });
  });

  it("acepta un porcentaje con un decimal que el punto flotante no da exacto", async () => {
    const detail = await saveWeek({
      weekNo: 1,
      note: null,
      dose: { sets: 3, reps: null, intensity: { kind: "pct", pct: 1.1 } },
    });

    expect(detail.weeks[0]?.dose?.intensity).toEqual({ kind: "pct", pct: 1.1 });
  });

  it("rechaza una semana que el ciclo no tiene", async () => {
    await expect(
      saveWeek({ weekNo: 5, note: "Late", dose: null }),
    ).rejects.toMatchObject({ code: "week_out_of_range" });
  });
});

describe("copyManagedCycleWeekOne", () => {
  it("copia la semana 1 de la 2 a la N − 2 y lo anota", async () => {
    cycles = [cycle(WINTER_ID, { weeks: 5 })];

    await copyManagedCycleWeekOne(gateways(), {
      callerId: COACH_ID,
      cycleId: WINTER_ID,
    });

    expect(copiedWeeks).toEqual([[2, 3]]);
    expect(lastAudit()).toMatchObject({
      action: "training_cycle.week_one_copied",
      entity_id: WINTER_ID,
    });
  });

  it("con menos de 4 semanas lo rechaza", async () => {
    cycles = [cycle(WINTER_ID, { weeks: 3 })];

    await expect(
      copyManagedCycleWeekOne(gateways(), {
        callerId: COACH_ID,
        cycleId: WINTER_ID,
      }),
    ).rejects.toMatchObject({ code: "too_few_weeks_to_copy" });
    expect(copiedWeeks).toEqual([]);
  });
});
