import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { isSameName, normalizeForSearch } from "@/lib/text/name-search";
import type {
  ClubCycleRecord,
  ClubCyclesGateways,
} from "@/lib/training/club-cycles";
import type {
  ClubExercisesGateways,
  ExerciseRecord,
} from "@/lib/training/club-exercises";
import type {
  ClubMarkRecord,
  ClubMarksGateways,
} from "@/lib/training/club-marks";
import type {
  ClubRoutinesGateways,
  ManagedRoutine,
} from "@/lib/training/club-routines";
import type { RoutineItemDraft } from "@/lib/training/routine-items";
import {
  type SampleCyclePlan,
  type SampleExercise,
  type SampleItem,
  buildSampleCyclePlan,
} from "@/lib/training/sample-cycle";
import {
  type SampleCycleGateways,
  loadSampleCycle,
} from "@/lib/training/sample-cycle-loader";

/**
 * La carga del ciclo de muestra con dobles en memoria (#938): cómo enlaza
 * cada ejercicio del plan, primero por la foto de su guía y luego por el
 * nombre, y qué cuenta el informe.
 */

const CLUB_ID = "club-1";
const CALLER_ID = "user-admin";
const SAMPLE_PATH = path.join(
  process.cwd(),
  "docs/design/design_handoff_training/muestra/plan-uwr-sep-2026.json",
);

type LibraryEntry = {
  readonly id: string;
  readonly name: string;
  readonly libraryKey: string;
};

type FakeDatabase = {
  readonly exercises: ExerciseRecord[];
  readonly libraryKeys: Map<string, string>;
  readonly cycles: ClubCycleRecord[];
  readonly routines: ManagedRoutine[];
  readonly items: Map<string, readonly RoutineItemDraft[]>;
  readonly marks: ClubMarkRecord[];
};

let database: FakeDatabase;

function newId(): string {
  return randomUUID();
}

function notUsed(): never {
  throw new Error("La carga no debería llamar a esto");
}

const members = {
  findRoleRequestMember: async (userId: string) =>
    userId === CALLER_ID
      ? { clubId: CLUB_ID, fullName: "Ada", role: "Admin" as const }
      : null,
};

const audit = { insertAuditLogRow: async () => ({ error: null }) };

function isVisible(exercise: ExerciseRecord): boolean {
  return exercise.clubId === null || exercise.clubId === CLUB_ID;
}

function clubExercises(): readonly ExerciseRecord[] {
  return database.exercises.filter((exercise) => exercise.clubId !== null);
}

function exercisesGateways(): ClubExercisesGateways {
  return {
    members,
    audit,
    newExerciseId: () => newId(),
    photos: { upload: notUsed, remove: notUsed, publicUrl: (path) => path },
    exercises: {
      searchExercises: async (query) =>
        database.exercises
          .filter(isVisible)
          .filter((exercise) =>
            normalizeForSearch(exercise.name).includes(
              normalizeForSearch(query.text),
            ),
          )
          .slice(query.offset, query.offset + query.limit),
      countExercises: async () => ({
        library: database.exercises.length - clubExercises().length,
        club: clubExercises().length,
      }),
      findExercise: async (exerciseId) =>
        database.exercises.find((exercise) => exercise.id === exerciseId) ??
        null,
      isNameTaken: async (query) =>
        database.exercises
          .filter(isVisible)
          .some((exercise) => isSameName(exercise.name, query.name)),
      listRoutineNames: async () => new Map(),
      insertExercise: async (row) => {
        database.exercises.push(row);
        return { kind: "saved" };
      },
      updateExercise: notUsed,
      deleteExercise: notUsed,
    },
  };
}

function cyclesGateways(): ClubCyclesGateways {
  const findCycle = async (target: { readonly cycleId: string }) =>
    database.cycles.find((cycle) => cycle.id === target.cycleId) ?? null;
  return {
    members,
    audit,
    cycles: {
      listCycles: async () => database.cycles,
      findCycle,
      readCyclePlan: async () => ({ weeks: [], days: [] }),
      insertCycle: async (fields) => {
        const id = newId();
        database.cycles.push({
          id,
          name: fields.name,
          status: "draft",
          weeks: fields.weeks,
          startDate: fields.startDate,
          event: null,
          ownRoutines: 0,
        });
        return id;
      },
      updateCycle: notUsed,
      activateCycle: notUsed,
      archiveCycle: notUsed,
      deleteCycle: notUsed,
      duplicateCycle: notUsed,
      findRoutineScope: async (_clubId, routineId) => {
        const routine = database.routines.find(
          (entry) => entry.id === routineId,
        );
        return routine?.cycleId
          ? { kind: "cycle", cycleId: routine.cycleId }
          : { kind: "missing" };
      },
      setDay: async () => undefined,
      saveWeek: async () => undefined,
      copyWeekOne: notUsed,
    },
  };
}

function routinesGateways(): ClubRoutinesGateways {
  return {
    members,
    audit,
    routines: {
      cycleExists: async (target) =>
        database.cycles.some((cycle) => cycle.id === target.cycleId),
      listRoutines: async (_clubId, cycleId) =>
        database.routines.filter((routine) => routine.cycleId === cycleId),
      findRoutine: async (target) =>
        database.routines.find((routine) => routine.id === target.routineId) ??
        null,
      insertRoutine: async (row) => {
        const routineId = newId();
        database.routines.push({
          id: routineId,
          name: row.name,
          cycleId: row.cycleId,
          colorIndex: row.colorIndex,
          itemCount: 0,
          daysUsed: 0,
        });
        return { kind: "created", routineId };
      },
      renameRoutine: notUsed,
      deleteRoutine: notUsed,
      findUnknownReferences: async (_clubId, ids) => ({
        exerciseIds: ids.exerciseIds.filter(
          (id) => !database.exercises.some((exercise) => exercise.id === id),
        ),
        markIds: ids.markIds.filter(
          (id) => !database.marks.some((mark) => mark.id === id),
        ),
      }),
      replaceItems: async (target, items) => {
        database.items.set(target.routineId, items);
        return { kind: "replaced" };
      },
      exerciseVisible: async () => true,
      findLastDose: async () => null,
      listItems: notUsed,
    },
  };
}

function marksGateways(): ClubMarksGateways {
  return {
    members,
    audit,
    marks: {
      listMarks: async () => database.marks,
      insertMark: async (mark) => {
        const markId = newId();
        database.marks.push({
          id: markId,
          name: mark.name,
          sortOrder: mark.sortOrder,
          routineRows: 0,
          membersRecorded: 0,
        });
        return { kind: "created", markId };
      },
      renameMark: notUsed,
      deleteMark: notUsed,
    },
  };
}

function createGateways(): SampleCycleGateways {
  return {
    cycles: cyclesGateways(),
    routines: routinesGateways(),
    marks: marksGateways(),
    exercises: exercisesGateways(),
    library: {
      findLibraryExercise: async (libraryKey) => {
        const id = database.libraryKeys.get(libraryKey);
        const found = database.exercises.find((exercise) => exercise.id === id);
        return found === undefined ? null : { id: found.id, name: found.name };
      },
    },
  };
}

function seedLibrary(entries: readonly LibraryEntry[]): void {
  for (const entry of entries) {
    database.exercises.push({
      id: entry.id,
      clubId: null,
      name: entry.name,
      tips: [],
      youtube: null,
      imageStartPath: null,
      imageEndPath: null,
    });
    database.libraryKeys.set(entry.libraryKey, entry.id);
  }
}

function sampleExercise(
  name: string,
  libraryKey: string | null,
): SampleExercise {
  return { name, libraryKey, tips: [`Cue of ${name}`], youtube: `${name} yt` };
}

function exerciseRow(name: string, note: string | null = null): SampleItem {
  return {
    kind: "exercise",
    exerciseName: name,
    sets: 3,
    reps: "5",
    rest: null,
    note,
    load: { kind: "none" },
  };
}

function planWith(
  exercises: readonly SampleExercise[],
  items: readonly SampleItem[] = exercises.map((exercise) =>
    exerciseRow(exercise.name),
  ),
): SampleCyclePlan {
  return {
    cycle: { name: "Sample", startDate: "2026-09-14", weeks: 1 },
    marks: [],
    exercises,
    routines: [{ name: "Gym", items }],
    weeks: [],
    days: [{ weekNo: 1, weekday: 0, slot: 1, routineIndex: 0 }],
  };
}

function savedRows(): readonly Extract<
  RoutineItemDraft,
  { readonly exerciseId: string }
>[] {
  return [...database.items.values()]
    .flat()
    .flatMap((item) => (item.kind === "section" ? [] : [item]));
}

async function load(plan: SampleCyclePlan) {
  const report = await loadSampleCycle(createGateways(), {
    callerId: CALLER_ID,
    plan,
  });
  if (report.kind !== "loaded") {
    throw new Error(`La carga respondió ${report.kind}`);
  }
  return report;
}

const DEADLIFT: LibraryEntry = {
  id: randomUUID(),
  name: "Barbell Deadlift",
  libraryKey: "Barbell_Deadlift",
};

beforeEach(() => {
  database = {
    exercises: [],
    libraryKeys: new Map(),
    cycles: [],
    routines: [],
    items: new Map(),
    marks: [],
  };
});

describe("loadSampleCycle: el enlace por la guía", () => {
  it("usa el ejercicio de la biblioteca con la clave de la guía y no crea ninguno del club", async () => {
    seedLibrary([DEADLIFT]);

    const report = await load(
      planWith([sampleExercise("Deadlift", "Barbell_Deadlift")]),
    );

    expect(clubExercises()).toEqual([]);
    expect(savedRows().map((row) => row.exerciseId)).toEqual([DEADLIFT.id]);
    expect(report.exercises).toEqual({
      linkedByGuide: 1,
      foundByName: 0,
      created: 0,
    });
  });

  it("da el mismo ejercicio de la biblioteca a dos nombres con la misma clave", async () => {
    seedLibrary([DEADLIFT]);

    await load(
      planWith([
        sampleExercise("Deadlift", "Barbell_Deadlift"),
        sampleExercise("Paused Deadlift", "Barbell_Deadlift"),
      ]),
    );

    expect(clubExercises()).toEqual([]);
    expect(savedRows().map((row) => row.exerciseId)).toEqual([
      DEADLIFT.id,
      DEADLIFT.id,
    ]);
  });

  it("pone el nombre del plan delante de la nota cuando el de la biblioteca es otro", async () => {
    seedLibrary([DEADLIFT]);
    const paused = sampleExercise("Paused Deadlift", "Barbell_Deadlift");

    await load(planWith([paused], [exerciseRow(paused.name, "RPE 8")]));

    expect(savedRows().map((row) => row.note)).toEqual([
      "Paused Deadlift · RPE 8",
    ]);
  });

  it("no repite en la nota el nombre que se lee igual que el de la biblioteca", async () => {
    seedLibrary([DEADLIFT]);
    const same = sampleExercise("barbell deadlift", "Barbell_Deadlift");

    await load(planWith([same], [exerciseRow(same.name, "RPE 8")]));

    expect(savedRows().map((row) => row.note)).toEqual(["RPE 8"]);
  });
});

describe("loadSampleCycle: sin enlace por la guía", () => {
  it("crea del club, con sus consejos y su YouTube, el ejercicio sin foto que no está", async () => {
    const report = await load(planWith([sampleExercise("Swim set", null)]));

    expect(
      clubExercises().map(({ name, tips, youtube }) => ({
        name,
        tips,
        youtube,
      })),
    ).toEqual([
      { name: "Swim set", tips: ["Cue of Swim set"], youtube: "Swim set yt" },
    ]);
    expect(report.exercises).toEqual({
      linkedByGuide: 0,
      foundByName: 0,
      created: 1,
    });
    expect(report.missingLibraryKeys).toEqual([]);
  });

  it("busca por nombre el de una clave que la biblioteca no tiene y la avisa", async () => {
    seedLibrary([DEADLIFT]);

    const report = await load(
      planWith([sampleExercise("Barbell Deadlift", "Gone_Key")]),
    );

    expect(clubExercises()).toEqual([]);
    expect(savedRows().map((row) => row.exerciseId)).toEqual([DEADLIFT.id]);
    expect(report.exercises).toEqual({
      linkedByGuide: 0,
      foundByName: 1,
      created: 0,
    });
    expect(report.missingLibraryKeys).toEqual([
      { name: "Barbell Deadlift", libraryKey: "Gone_Key" },
    ]);
  });

  it("crea del club el de una clave ausente que tampoco está por nombre", async () => {
    const report = await load(
      planWith([sampleExercise("Paused Deadlift", "Barbell_Deadlift")]),
    );

    expect(clubExercises().map((exercise) => exercise.name)).toEqual([
      "Paused Deadlift",
    ]);
    expect(savedRows().map((row) => row.note)).toEqual([null]);
    expect(report.missingLibraryKeys).toEqual([
      { name: "Paused Deadlift", libraryKey: "Barbell_Deadlift" },
    ]);
  });

  it("cuenta en el informe las tres vías", async () => {
    seedLibrary([
      DEADLIFT,
      { id: randomUUID(), name: "Inverted Row", libraryKey: "Inverted_Row" },
    ]);

    const report = await load(
      planWith([
        sampleExercise("Deadlift", "Barbell_Deadlift"),
        sampleExercise("Paused Deadlift", "Barbell_Deadlift"),
        sampleExercise("Inverted Row", null),
        sampleExercise("ESC interval", null),
      ]),
    );

    expect(report.exercises).toEqual({
      linkedByGuide: 2,
      foundByName: 1,
      created: 1,
    });
  });
});

describe("loadSampleCycle: el plan real", () => {
  const plan = buildSampleCyclePlan(
    JSON.parse(readFileSync(SAMPLE_PATH, "utf8")),
  );
  const keys = [
    ...new Set(
      plan.exercises.flatMap((exercise) =>
        exercise.libraryKey === null ? [] : [exercise.libraryKey],
      ),
    ),
  ];

  it("con las 29 claves en la biblioteca, sólo crea del club los ejercicios sin foto en la guía", async () => {
    seedLibrary(
      keys.map((libraryKey) => ({
        id: randomUUID(),
        name: libraryKey.replaceAll("_", " "),
        libraryKey,
      })),
    );
    const withoutPhoto = plan.exercises.filter(
      (exercise) => exercise.libraryKey === null,
    );

    const report = await load(plan);

    expect(keys).toHaveLength(29);
    expect(
      clubExercises().map((exercise) => normalizeForSearch(exercise.name)),
    ).toEqual(
      withoutPhoto.map((exercise) => normalizeForSearch(exercise.name)),
    );
    expect(report.exercises.linkedByGuide).toBe(38);
    expect(report.missingLibraryKeys).toEqual([]);
  });

  it("la segunda vez dice que ya está cargado y no toca nada", async () => {
    await load(plan);
    const exercisesBefore = database.exercises.length;
    const routinesBefore = database.routines.length;

    const second = await loadSampleCycle(createGateways(), {
      callerId: CALLER_ID,
      plan,
    });

    expect(second).toEqual({
      kind: "already_loaded",
      cycleId: database.cycles[0]?.id,
    });
    expect(database.exercises).toHaveLength(exercisesBefore);
    expect(database.routines).toHaveLength(routinesBefore);
  });
});
