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
import {
  type SampleCyclePlan,
  type SampleExercise,
  type SampleItem,
  type SampleLoad,
  rowNoteFor,
} from "./sample-cycle";
import { createClubCyclesGateways } from "./supabase-club-cycles-gateways";
import { createClubExercisesGateways } from "./supabase-club-exercises-gateways";
import { createClubMarksGateways } from "./supabase-club-marks-gateways";
import { createClubRoutinesGateways } from "./supabase-club-routines-gateways";
import { findLibraryExerciseByKey } from "./supabase-exercise-library-gateways";

/**
 * Carga el plan de muestra como un ciclo en borrador (#912, RF-13 y D16 del
 * PRD de E35). Todo pasa por los dominios de Planificar (#903, #904 y #905),
 * como si el Admin o el Coach lo escribiera a mano: valen sus validaciones y
 * cada paso deja su bitácora.
 *
 * Un ciclo con el mismo nombre en el club es que ya se cargó: no se toca
 * nada.
 */

/** El ejercicio en que queda una fila del plan, con el nombre que tiene en
 * la base. */
export type LinkedExercise = { readonly id: string; readonly name: string };

export type SampleLibraryGateway = {
  findLibraryExercise(libraryKey: string): Promise<LinkedExercise | null>;
};

export type SampleCycleGateways = {
  readonly cycles: ClubCyclesGateways;
  readonly routines: ClubRoutinesGateways;
  readonly marks: ClubMarksGateways;
  readonly exercises: ClubExercisesGateways;
  readonly library: SampleLibraryGateway;
};

/** Cuántos ejercicios del plan se enlazaron por cada vía. */
export type ExerciseLinkCounts = {
  readonly linkedByGuide: number;
  readonly foundByName: number;
  readonly created: number;
};

/** Una foto de la guía cuya clave no está en la biblioteca de esa base. */
export type MissingLibraryKey = {
  readonly name: string;
  readonly libraryKey: string;
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
      readonly exercises: ExerciseLinkCounts;
      readonly missingLibraryKeys: readonly MissingLibraryKey[];
    };

type LoadRequest = {
  readonly callerId: string;
  readonly plan: SampleCyclePlan;
};

/** Por nombre, sin contar mayúsculas ni tildes. */
type ByName<T> = ReadonlyMap<string, T>;

type LinkRoute = keyof ExerciseLinkCounts;

type ExerciseLink = {
  readonly exercise: LinkedExercise;
  readonly route: LinkRoute;
  readonly missingLibraryKey: string | null;
};

type EnsuredExercises = {
  readonly links: ByName<LinkedExercise>;
  readonly counts: ExerciseLinkCounts;
  readonly missingLibraryKeys: readonly MissingLibraryKey[];
};

type LoadedIds = {
  readonly exercises: ByName<LinkedExercise>;
  readonly marks: ByName<string>;
};

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
    library: {
      findLibraryExercise: (libraryKey) =>
        findLibraryExerciseByKey(serviceClient, libraryKey),
    },
  };
}

function nameKey(name: string): string {
  return normalizeForSearch(name.trim());
}

function entryOf<T>(entries: ByName<T>, name: string): T {
  const entry = entries.get(nameKey(name));
  if (entry === undefined) {
    throw new Error(`No se encontró "${name}" entre lo que se cargó.`);
  }
  return entry;
}

/** Las marcas que faltan se crean al final de la lista del club. */
async function ensureMarks(
  gateways: SampleCycleGateways,
  request: LoadRequest,
): Promise<{ readonly ids: ByName<string>; readonly created: number }> {
  const { callerId } = request;
  let { marks } = await listClubMarks(gateways.marks, callerId);
  const missing = request.plan.marks.filter(
    (name) => !marks.some((mark) => isSameName(mark.name, name)),
  );
  for (const name of missing) {
    ({ marks } = await createClubMark(gateways.marks, { callerId, name }));
  }
  const ids = new Map(marks.map((mark) => [nameKey(mark.name), mark.id]));
  return { ids, created: missing.length };
}

/** El de la biblioteca o del club que se llame igual, o nulo. */
async function findExerciseByName(
  gateways: SampleCycleGateways,
  request: { readonly callerId: string; readonly name: string },
): Promise<LinkedExercise | null> {
  const { exercises } = await searchExercises(gateways.exercises, {
    callerId: request.callerId,
    query: request.name,
  });
  const match = exercises.find((exercise) =>
    isSameName(exercise.name, request.name),
  );
  return match === undefined ? null : { id: match.id, name: match.name };
}

async function createExercise(
  gateways: SampleCycleGateways,
  request: { readonly callerId: string; readonly exercise: SampleExercise },
): Promise<LinkedExercise> {
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
  return { id: created.id, name: exercise.name };
}

/** Primero el de la biblioteca con la clave de la foto de su guía; si la
 * biblioteca de esta base no la tiene, como sin foto: por nombre o del
 * club. */
async function linkExercise(
  gateways: SampleCycleGateways,
  request: { readonly callerId: string; readonly exercise: SampleExercise },
): Promise<ExerciseLink> {
  const { libraryKey } = request.exercise;
  if (libraryKey !== null) {
    const linked = await gateways.library.findLibraryExercise(libraryKey);
    if (linked !== null) {
      return {
        exercise: linked,
        route: "linkedByGuide",
        missingLibraryKey: null,
      };
    }
  }
  const found = await findExerciseByName(gateways, {
    callerId: request.callerId,
    name: request.exercise.name,
  });
  return {
    exercise: found ?? (await createExercise(gateways, request)),
    route: found === null ? "created" : "foundByName",
    missingLibraryKey: libraryKey,
  };
}

async function ensureExercises(
  gateways: SampleCycleGateways,
  request: LoadRequest,
): Promise<EnsuredExercises> {
  const links = new Map<string, LinkedExercise>();
  const counts = { linkedByGuide: 0, foundByName: 0, created: 0 };
  const missingLibraryKeys: MissingLibraryKey[] = [];
  for (const exercise of request.plan.exercises) {
    const link = await linkExercise(gateways, {
      callerId: request.callerId,
      exercise,
    });
    links.set(nameKey(exercise.name), link.exercise);
    counts[link.route] += 1;
    if (link.missingLibraryKey !== null) {
      missingLibraryKeys.push({
        name: exercise.name,
        libraryKey: link.missingLibraryKey,
      });
    }
  }
  return { links, counts, missingLibraryKeys };
}

function loadDraft(
  load: SampleLoad,
  markIds: ByName<string>,
): RoutineLoadDraft {
  return load.kind === "week"
    ? { kind: "week", markId: entryOf(markIds, load.markName) }
    : load;
}

function itemDraft(item: SampleItem, ids: LoadedIds): RoutineItemDraft {
  if (item.kind === "section") {
    return item;
  }
  const { exerciseName, load, note, ...dose } = item;
  const exercise = entryOf(ids.exercises, exerciseName);
  return {
    ...dose,
    exerciseId: exercise.id,
    note: rowNoteFor({ exerciseName, note }, exercise.name),
    load: loadDraft(load, ids.marks),
  };
}

/** En el orden del plan, una a una: el color de cada rutina sale de cuántas
 * hay ya en el ciclo. */
async function createRoutines(
  gateways: SampleCycleGateways,
  request: LoadRequest & {
    readonly cycleId: string;
    readonly ids: LoadedIds;
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

/** Con el ciclo ya creado, un fallo deja el borrador a medias, y la
 * siguiente corrida lo daría por cargado: el error lo nombra. */
async function fillCycle(
  gateways: SampleCycleGateways,
  request: LoadRequest & {
    readonly cycleId: string;
    readonly ids: LoadedIds;
  },
): Promise<readonly string[]> {
  try {
    const routineIds = await createRoutines(gateways, request);
    await fillWeeksAndDays(gateways, { ...request, routineIds });
    return routineIds;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `El borrador ${request.cycleId} quedó incompleto (${reason}): archívalo y renómbralo antes de volver a cargar.`,
      { cause: error },
    );
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
  const routineIds = await fillCycle(gateways, {
    ...request,
    cycleId: cycle.id,
    ids: { exercises: exercises.links, marks: marks.ids },
  });
  return {
    kind: "loaded",
    cycleId: cycle.id,
    routines: routineIds.length,
    days: countDaysWithSessions(request.plan),
    marksCreated: marks.created,
    exercises: exercises.counts,
    missingLibraryKeys: exercises.missingLibraryKeys,
  };
}
