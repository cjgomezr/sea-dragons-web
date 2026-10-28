import type { SupabaseClient } from "@supabase/supabase-js";
import { isSameName, normalizeForSearch } from "@/lib/text/name-search";
import {
  type ClubCyclesGateways,
  createManagedCycle,
  listManagedCycles,
  saveManagedCycleWeek,
  setManagedCycleDay,
} from "./club-cycles";
import {
  type ClubExercisesGateways,
  createClubExercise,
  searchExercises,
} from "./club-exercises";
import {
  type ClubMarksGateways,
  createClubMark,
  listClubMarks,
} from "./club-marks";
import {
  type ClubRoutinesGateways,
  createClubRoutine,
  saveRoutineItems,
} from "./club-routines";
import type { RoutineItemDraft, RoutineLoadDraft } from "./routine-items";
import type {
  SampleCyclePlan,
  SampleExercise,
  SampleItem,
  SampleLoad,
} from "./sample-cycle";
import { createClubCyclesGateways } from "./supabase-club-cycles-gateways";
import { createClubExercisesGateways } from "./supabase-club-exercises-gateways";
import { createClubMarksGateways } from "./supabase-club-marks-gateways";
import { createClubRoutinesGateways } from "./supabase-club-routines-gateways";

/**
 * Carga el plan de muestra como un ciclo en borrador (#912, RF-13 y D16 del
 * PRD de E35). Todo pasa por los dominios de Planificar (#903, #904 y #905),
 * como si el Admin o el Coach lo escribiera a mano: valen sus validaciones y
 * cada paso deja su bitácora.
 *
 * Un ciclo con el mismo nombre en el club es que ya se cargó: no se toca
 * nada.
 */

export type SampleCycleGateways = {
  readonly cycles: ClubCyclesGateways;
  readonly routines: ClubRoutinesGateways;
  readonly marks: ClubMarksGateways;
  readonly exercises: ClubExercisesGateways;
};

export type SampleCycleReport =
  | { readonly kind: "already_loaded"; readonly cycleId: string }
  | {
      readonly kind: "loaded";
      readonly cycleId: string;
      readonly routines: number;
      /** Los días con alguna sesión; uno con dos cuenta una vez. */
      readonly days: number;
      readonly marksCreated: number;
      readonly exercisesCreated: number;
    };

type LoadRequest = {
  readonly callerId: string;
  readonly plan: SampleCyclePlan;
};

/** Los ids por nombre, sin contar mayúsculas ni tildes. */
type IdsByName = ReadonlyMap<string, string>;

type Ensured = { readonly ids: IdsByName; readonly created: number };

const NO_PHOTO_CHANGES = {
  start: { kind: "keep" },
  end: { kind: "keep" },
} as const;

export function createSampleCycleGateways(
  serviceClient: SupabaseClient,
): SampleCycleGateways {
  return {
    cycles: createClubCyclesGateways(serviceClient),
    routines: createClubRoutinesGateways(serviceClient),
    marks: createClubMarksGateways(serviceClient),
    exercises: createClubExercisesGateways(serviceClient),
  };
}

function idOf(ids: IdsByName, name: string): string {
  const id = ids.get(normalizeForSearch(name.trim()));
  if (id === undefined) {
    throw new Error(`No se encontró "${name}" entre lo que se cargó.`);
  }
  return id;
}

/** Las marcas que faltan se crean al final de la lista del club. */
async function ensureMarks(
  gateways: SampleCycleGateways,
  request: LoadRequest,
): Promise<Ensured> {
  const { callerId } = request;
  let { marks } = await listClubMarks(gateways.marks, callerId);
  const missing = request.plan.marks.filter(
    (name) => !marks.some((mark) => isSameName(mark.name, name)),
  );
  for (const name of missing) {
    ({ marks } = await createClubMark(gateways.marks, { callerId, name }));
  }
  const ids = new Map(
    marks.map((mark) => [normalizeForSearch(mark.name.trim()), mark.id]),
  );
  return { ids, created: missing.length };
}

/** El de la biblioteca o del club que se llame igual, o nulo. */
async function findExerciseId(
  gateways: SampleCycleGateways,
  request: { readonly callerId: string; readonly name: string },
): Promise<string | null> {
  const { exercises } = await searchExercises(gateways.exercises, {
    callerId: request.callerId,
    query: request.name,
  });
  const match = exercises.find((exercise) =>
    isSameName(exercise.name, request.name),
  );
  return match === undefined ? null : match.id;
}

async function createExercise(
  gateways: SampleCycleGateways,
  request: { readonly callerId: string; readonly exercise: SampleExercise },
): Promise<string> {
  const { exercise } = request;
  const created = await createClubExercise(gateways.exercises, {
    callerId: request.callerId,
    fields: {
      name: exercise.name,
      tips: exercise.tips.join("\n"),
      youtube: exercise.youtube,
    },
    photos: NO_PHOTO_CHANGES,
  });
  return created.id;
}

/** Los que no están en la biblioteca ni en el club se crean del club. */
async function ensureExercises(
  gateways: SampleCycleGateways,
  request: LoadRequest,
): Promise<Ensured> {
  const { callerId } = request;
  const ids = new Map<string, string>();
  let created = 0;
  for (const exercise of request.plan.exercises) {
    const found = await findExerciseId(gateways, {
      callerId,
      name: exercise.name,
    });
    if (found === null) {
      created += 1;
    }
    ids.set(
      normalizeForSearch(exercise.name.trim()),
      found ?? (await createExercise(gateways, { callerId, exercise })),
    );
  }
  return { ids, created };
}

function loadDraft(load: SampleLoad, markIds: IdsByName): RoutineLoadDraft {
  return load.kind === "week"
    ? { kind: "week", markId: idOf(markIds, load.markName) }
    : load;
}

function itemDraft(
  item: SampleItem,
  ids: { readonly exercises: IdsByName; readonly marks: IdsByName },
): RoutineItemDraft {
  if (item.kind === "section") {
    return item;
  }
  const { exerciseName, load, ...dose } = item;
  return {
    ...dose,
    exerciseId: idOf(ids.exercises, exerciseName),
    load: loadDraft(load, ids.marks),
  };
}

/** En el orden del plan, una a una: el color de cada rutina sale de cuántas
 * hay ya en el ciclo. */
async function createRoutines(
  gateways: SampleCycleGateways,
  request: LoadRequest & {
    readonly cycleId: string;
    readonly ids: { readonly exercises: IdsByName; readonly marks: IdsByName };
  },
): Promise<readonly string[]> {
  const { callerId, cycleId } = request;
  const routineIds: string[] = [];
  for (const routine of request.plan.routines) {
    const { routine: created } = await createClubRoutine(gateways.routines, {
      callerId,
      cycleId,
      name: routine.name,
    });
    await saveRoutineItems(gateways.routines, {
      callerId,
      routineId: created.id,
      items: routine.items.map((item) => itemDraft(item, request.ids)),
    });
    routineIds.push(created.id);
  }
  return routineIds;
}

async function fillWeeksAndDays(
  gateways: SampleCycleGateways,
  request: LoadRequest & {
    readonly cycleId: string;
    readonly routineIds: readonly string[];
  },
): Promise<void> {
  const { callerId, cycleId, routineIds } = request;
  for (const week of request.plan.weeks) {
    await saveManagedCycleWeek(gateways.cycles, { callerId, cycleId, week });
  }
  for (const { routineIndex, ...day } of request.plan.days) {
    const routineId = routineIds[routineIndex];
    if (routineId === undefined) {
      throw new Error(
        `El día ${JSON.stringify(day)} nombra una rutina que no hay.`,
      );
    }
    await setManagedCycleDay(gateways.cycles, {
      callerId,
      cycleId,
      day: { ...day, routineId },
    });
  }
}

function countDaysWithSessions(plan: SampleCyclePlan): number {
  return new Set(plan.days.map((day) => `${day.weekNo}:${day.weekday}`)).size;
}

async function findLoadedCycleId(
  gateways: SampleCycleGateways,
  request: LoadRequest,
): Promise<string | null> {
  const { cycles } = await listManagedCycles(gateways.cycles, request.callerId);
  const loaded = cycles.find((cycle) =>
    isSameName(cycle.name, request.plan.cycle.name),
  );
  return loaded === undefined ? null : loaded.id;
}

export async function loadSampleCycle(
  gateways: SampleCycleGateways,
  request: LoadRequest,
): Promise<SampleCycleReport> {
  const loadedCycleId = await findLoadedCycleId(gateways, request);
  if (loadedCycleId !== null) {
    return { kind: "already_loaded", cycleId: loadedCycleId };
  }
  const marks = await ensureMarks(gateways, request);
  const exercises = await ensureExercises(gateways, request);
  const { cycle } = await createManagedCycle(gateways.cycles, {
    callerId: request.callerId,
    input: {
      name: request.plan.cycle.name,
      weeks: request.plan.cycle.weeks,
      schedule: { kind: "start", startDate: request.plan.cycle.startDate },
    },
  });
  const routineIds = await createRoutines(gateways, {
    ...request,
    cycleId: cycle.id,
    ids: { exercises: exercises.ids, marks: marks.ids },
  });
  await fillWeeksAndDays(gateways, {
    ...request,
    cycleId: cycle.id,
    routineIds,
  });
  return {
    kind: "loaded",
    cycleId: cycle.id,
    routines: routineIds.length,
    days: countDaysWithSessions(request.plan),
    marksCreated: marks.created,
    exercisesCreated: exercises.created,
  };
}
