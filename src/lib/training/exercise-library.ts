import { z } from "zod";
import { normalizeForSearch } from "@/lib/text/name-search";

/**
 * La biblioteca de ejercicios (#897, RF-2 y D12 del PRD de E35): una copia de
 * free-exercise-db (dominio público) en `training_exercises` y en el bucket
 * `training-exercise-images`. Pura: qué fila sale de cada entrada del origen
 * y qué hace la carga con lo que ya hay. La E/S está en
 * `exercise-library-loader.ts`.
 */

/** Lo que se usa de una entrada de `dist/exercises.json`. El resto (músculos,
 * equipo, nivel) no tiene dónde ir todavía. */
export type LibrarySourceEntry = {
  readonly id: string;
  readonly name: string;
  readonly instructions: readonly string[];
  readonly images: readonly string[];
};

/** Una foto del origen y dónde queda en Storage. */
export type LibraryPhoto = {
  readonly sourcePath: string;
  readonly storagePath: string;
};

/** Un ejercicio de la biblioteca listo para la base. */
export type LibraryExercise = {
  readonly libraryKey: string;
  readonly name: string;
  readonly tips: readonly string[];
  /** La de inicio y la de final, en ese orden; ninguna si el origen no trae. */
  readonly photos: readonly LibraryPhoto[];
};

/** Lo que la base ya tiene de un ejercicio de la biblioteca. */
export type StoredLibraryExercise = {
  readonly libraryKey: string;
  readonly name: string;
  readonly tips: readonly string[];
  readonly imageStartPath: string | null;
  readonly imageEndPath: string | null;
};

/** Un ejercicio que no se carga porque otro ya usa su nombre. */
export type NameClash = {
  readonly libraryKey: string;
  readonly sameNameAs: string;
};

export type LibraryLoadStep =
  | { readonly kind: "insert"; readonly exercise: LibraryExercise }
  | { readonly kind: "update"; readonly exercise: LibraryExercise }
  | { readonly kind: "unchanged"; readonly exercise: LibraryExercise };

export type LibraryLoadPlan = {
  readonly steps: readonly LibraryLoadStep[];
  readonly nameClashes: readonly NameClash[];
};

/** La foto de inicio y la de final (D12); el origen trae dos casi siempre. */
const PHOTOS_PER_EXERCISE = 2;
/** `training_exercises_name_length`: de 1 a 80 sin los bordes. */
const MAX_EXERCISE_NAME_LENGTH = 80;
const STORAGE_PREFIX = "library";

const sourceEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(MAX_EXERCISE_NAME_LENGTH),
  instructions: z.array(z.string()),
  images: z.array(z.string()),
});

const sourceSchema = z.array(sourceEntrySchema);

/** Las entradas del origen, o un error que dice cuál no tiene la forma
 * esperada. */
export function parseLibrarySource(
  json: unknown,
): readonly LibrarySourceEntry[] {
  const parsed = sourceSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `El JSON de free-exercise-db no tiene la forma esperada: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data.map(({ id, name, instructions, images }) => ({
    id,
    name,
    instructions,
    images,
  }));
}

/** El nombre como lo compara el índice único de la base: sin bordes, sin
 * mayúsculas y sin tildes (`search_normalize`). */
function nameKey(name: string): string {
  return normalizeForSearch(name.trim());
}

function toLibraryExercise(entry: LibrarySourceEntry): LibraryExercise {
  return {
    libraryKey: entry.id,
    name: entry.name.trim(),
    tips: entry.instructions
      .map((instruction) => instruction.trim())
      .filter((instruction) => instruction !== ""),
    photos: entry.images
      .slice(0, PHOTOS_PER_EXERCISE)
      .map((sourcePath, index) => ({
        sourcePath,
        storagePath: `${STORAGE_PREFIX}/${entry.id}/${index}.jpg`,
      })),
  };
}

/** Los ejercicios del origen, sin los que repiten el nombre de uno anterior:
 * la base sólo admite un nombre por ámbito. */
export function toLibraryExercises(entries: readonly LibrarySourceEntry[]): {
  readonly exercises: readonly LibraryExercise[];
  readonly duplicates: readonly NameClash[];
} {
  const keyByName = new Map<string, string>();
  const exercises: LibraryExercise[] = [];
  const duplicates: NameClash[] = [];
  for (const entry of entries) {
    const firstKey = keyByName.get(nameKey(entry.name));
    if (firstKey !== undefined) {
      duplicates.push({ libraryKey: entry.id, sameNameAs: firstKey });
      continue;
    }
    keyByName.set(nameKey(entry.name), entry.id);
    exercises.push(toLibraryExercise(entry));
  }
  return { exercises, duplicates };
}

function isSameTips(one: readonly string[], other: readonly string[]): boolean {
  return (
    one.length === other.length &&
    one.every((tip, index) => tip === other[index])
  );
}

function isStoredAsIs(
  exercise: LibraryExercise,
  stored: StoredLibraryExercise,
): boolean {
  return (
    exercise.name === stored.name &&
    isSameTips(exercise.tips, stored.tips) &&
    (exercise.photos[0]?.storagePath ?? null) === stored.imageStartPath &&
    (exercise.photos[1]?.storagePath ?? null) === stored.imageEndPath
  );
}

function stepFor(
  exercise: LibraryExercise,
  stored: StoredLibraryExercise | undefined,
): LibraryLoadStep {
  if (stored === undefined) {
    return { kind: "insert", exercise };
  }
  return isStoredAsIs(exercise, stored)
    ? { kind: "unchanged", exercise }
    : { kind: "update", exercise };
}

/**
 * Qué se inserta, qué se actualiza y qué se deja, dado lo que ya hay. Nunca
 * borra: un ejercicio que el origen quitó puede estar en una rutina. Salta
 * el que tomaría el nombre de otro ejercicio de la base, que el índice único
 * rechazaría.
 */
export function planLibraryLoad(
  exercises: readonly LibraryExercise[],
  stored: readonly StoredLibraryExercise[],
): LibraryLoadPlan {
  const storedByKey = new Map(stored.map((row) => [row.libraryKey, row]));
  const keyByName = new Map(
    stored.map((row) => [nameKey(row.name), row.libraryKey]),
  );
  const steps: LibraryLoadStep[] = [];
  const nameClashes: NameClash[] = [];
  for (const exercise of exercises) {
    const owner = keyByName.get(nameKey(exercise.name));
    if (owner !== undefined && owner !== exercise.libraryKey) {
      nameClashes.push({ libraryKey: exercise.libraryKey, sameNameAs: owner });
      continue;
    }
    steps.push(stepFor(exercise, storedByKey.get(exercise.libraryKey)));
  }
  return { steps, nameClashes };
}
