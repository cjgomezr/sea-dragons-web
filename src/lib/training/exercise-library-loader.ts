import { createHash } from "node:crypto";
import {
  type LibraryExercise,
  type LibraryLoadStep,
  type LibraryPhoto,
  type NameClash,
  type StoredLibraryExercise,
  parseLibrarySource,
  planLibraryLoad,
  toLibraryExercises,
} from "./exercise-library";

/**
 * La carga de la biblioteca de free-exercise-db (#897): descarga, sube las
 * fotos y guarda las filas. El origen y la base llegan como puertos, para
 * probarla con dobles; los de verdad están en
 * `supabase-exercise-library-gateways.ts`.
 */

/** El origen: el JSON y las fotos de una versión fija. */
export type LibrarySource = {
  readonly fetchEntries: () => Promise<unknown>;
  readonly fetchPhoto: (sourcePath: string) => Promise<Uint8Array>;
};

/** La foto ya descargada, con la huella de su contenido. */
export type PhotoUpload = {
  readonly storagePath: string;
  readonly bytes: Uint8Array;
  readonly fingerprint: string;
};

/** La base y el bucket. */
export type LibraryStore = {
  readonly readExercises: () => Promise<readonly StoredLibraryExercise[]>;
  /** La huella con la que se subió la foto, o `null` si no está. */
  readonly readPhotoFingerprint: (
    storagePath: string,
  ) => Promise<string | null>;
  readonly uploadPhoto: (photo: PhotoUpload) => Promise<void>;
  readonly saveExercise: (exercise: LibraryExercise) => Promise<void>;
};

export type LibraryLoadReport = {
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly skipped: number;
  readonly photosUploaded: number;
  readonly photosKept: number;
};

/** Pocos a la vez, para no topar con los límites de Storage (unos 33 MB de
 * fotos en total). */
export const PHOTO_CONCURRENCY = 4;

type PhotoOutcome = "uploaded" | "kept";

function fingerprintOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchEntries(source: LibrarySource): Promise<unknown> {
  try {
    return await source.fetchEntries();
  } catch (error) {
    throw new Error(
      `No se pudo descargar el origen de free-exercise-db: ${messageOf(error)}`,
    );
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function downloadPhoto(
  source: LibrarySource,
  exercise: LibraryExercise,
  photo: LibraryPhoto,
): Promise<PhotoUpload> {
  try {
    const bytes = await source.fetchPhoto(photo.sourcePath);
    return {
      storagePath: photo.storagePath,
      bytes,
      fingerprint: fingerprintOf(bytes),
    };
  } catch (error) {
    throw new Error(
      `No se pudo descargar la foto ${photo.sourcePath} de ${exercise.libraryKey}: ${messageOf(error)}`,
    );
  }
}

/** Sube la foto sólo si no está o si su contenido cambió. */
async function syncPhoto(
  store: LibraryStore,
  upload: PhotoUpload,
): Promise<PhotoOutcome> {
  const stored = await store.readPhotoFingerprint(upload.storagePath);
  if (stored === upload.fingerprint) {
    return "kept";
  }
  await store.uploadPhoto(upload);
  return "uploaded";
}

/** Las fotos primero y la fila al final: si algo falla, la fila no queda
 * apuntando a una foto que no subió. Una foto tras otra, para que el tope de
 * concurrencia sea el de ejercicios. */
async function applyStep(
  options: { readonly source: LibrarySource; readonly store: LibraryStore },
  step: LibraryLoadStep,
): Promise<readonly PhotoOutcome[]> {
  const { source, store } = options;
  const outcomes: PhotoOutcome[] = [];
  for (const photo of step.exercise.photos) {
    const upload = await downloadPhoto(source, step.exercise, photo);
    outcomes.push(await syncPhoto(store, upload));
  }
  if (step.kind !== "unchanged") {
    await store.saveExercise(step.exercise);
  }
  return outcomes;
}

/** Corre `work` sobre cada elemento con `limit` a la vez. Al primer fallo
 * deja de tomar elementos nuevos y lo propaga. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<readonly R[]> {
  const results: R[] = [];
  let next = 0;
  let hasFailed = false;
  async function worker(): Promise<void> {
    while (!hasFailed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await work(items[index] as T);
      } catch (error) {
        hasFailed = true;
        throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

function warnAbout(
  clashes: readonly NameClash[],
  log: (line: string) => void,
): void {
  for (const clash of clashes) {
    log(
      `aviso: ${clash.libraryKey} no se carga: su nombre es el de ${clash.sameNameAs}.`,
    );
  }
}

function countSteps(
  steps: readonly LibraryLoadStep[],
  kind: LibraryLoadStep["kind"],
): number {
  return steps.filter((step) => step.kind === kind).length;
}

/**
 * Carga la biblioteca: inserta lo nuevo, actualiza lo que cambió y sube sólo
 * las fotos que no están o cambiaron. Nunca borra. Termina con error, y dice
 * cuál, si falla el origen, una foto o la base.
 */
export async function loadExerciseLibrary(options: {
  readonly source: LibrarySource;
  readonly store: LibraryStore;
  readonly log: (line: string) => void;
}): Promise<LibraryLoadReport> {
  const { source, store, log } = options;
  const entries = parseLibrarySource(await fetchEntries(source));
  const { exercises, duplicates } = toLibraryExercises(entries);
  const plan = planLibraryLoad(exercises, await store.readExercises());
  warnAbout([...duplicates, ...plan.nameClashes], log);

  const photoOutcomes = (
    await mapWithConcurrency(plan.steps, PHOTO_CONCURRENCY, (step) =>
      applyStep({ source, store }, step),
    )
  ).flat();

  return {
    inserted: countSteps(plan.steps, "insert"),
    updated: countSteps(plan.steps, "update"),
    unchanged: countSteps(plan.steps, "unchanged"),
    skipped: duplicates.length + plan.nameClashes.length,
    photosUploaded: photoOutcomes.filter((outcome) => outcome === "uploaded")
      .length,
    photosKept: photoOutcomes.filter((outcome) => outcome === "kept").length,
  };
}
