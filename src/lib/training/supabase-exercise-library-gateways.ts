import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  LibraryExercise,
  StoredLibraryExercise,
} from "./exercise-library";
import type { LibraryStore, PhotoUpload } from "./exercise-library-loader";

/**
 * La biblioteca en Supabase (#897): `training_exercises` y el bucket
 * `training-exercise-images` de `0083_training.sql`. Con la llave de
 * servicio: sólo el servidor escribe ahí (D4).
 */

export const EXERCISE_IMAGES_BUCKET = "training-exercise-images";
const EXERCISES_TABLE = "training_exercises";
const LIBRARY_SOURCE = "library";
/** Lo que PostgREST devuelve como mucho en una página. */
const PAGE_SIZE = 1000;
/** La huella del contenido de la foto, en sus metadatos de Storage: así una
 * carga repetida sabe que ya está sin descargarla. */
const FINGERPRINT_METADATA_KEY = "sourceSha256";

type StoredRow = {
  readonly library_key: string;
  readonly name: string;
  readonly tips: readonly string[];
  readonly image_start_path: string | null;
  readonly image_end_path: string | null;
};

function toStored(row: StoredRow): StoredLibraryExercise {
  return {
    libraryKey: row.library_key,
    name: row.name,
    tips: row.tips,
    imageStartPath: row.image_start_path,
    imageEndPath: row.image_end_path,
  };
}

async function readExercisePage(
  client: SupabaseClient,
  from: number,
): Promise<readonly StoredRow[]> {
  const { data, error } = await client
    .from(EXERCISES_TABLE)
    .select("library_key, name, tips, image_start_path, image_end_path")
    .eq("source", LIBRARY_SOURCE)
    .order("library_key")
    .range(from, from + PAGE_SIZE - 1);
  if (error) {
    throw new Error(`No se pudo leer la biblioteca: ${error.message}`);
  }
  return data as StoredRow[];
}

async function readExercises(
  client: SupabaseClient,
): Promise<readonly StoredLibraryExercise[]> {
  const rows: StoredRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await readExercisePage(client, from);
    rows.push(...page);
    if (page.length < PAGE_SIZE) {
      return rows.map(toStored);
    }
  }
}

async function readPhotoFingerprint(
  client: SupabaseClient,
  storagePath: string,
): Promise<string | null> {
  const bucket = client.storage.from(EXERCISE_IMAGES_BUCKET);
  const exists = await bucket.exists(storagePath);
  // Si no está, `exists()` da `data: false` junto con el error 400 o 404 de
  // Storage; cualquier otro fallo lo lanza.
  if (exists.data === false) {
    return null;
  }
  if (exists.error) {
    throw new Error(
      `No se pudo comprobar la foto ${storagePath}: ${exists.error.message}`,
    );
  }
  const info = await bucket.info(storagePath);
  if (info.error) {
    throw new Error(
      `No se pudo leer la foto ${storagePath}: ${info.error.message}`,
    );
  }
  const fingerprint: unknown = info.data.metadata?.[FINGERPRINT_METADATA_KEY];
  return typeof fingerprint === "string" ? fingerprint : null;
}

async function uploadPhoto(
  client: SupabaseClient,
  photo: PhotoUpload,
): Promise<void> {
  const { error } = await client.storage
    .from(EXERCISE_IMAGES_BUCKET)
    .upload(photo.storagePath, photo.bytes, {
      contentType: "image/jpeg",
      upsert: true,
      metadata: { [FINGERPRINT_METADATA_KEY]: photo.fingerprint },
    });
  if (error) {
    throw new Error(
      `No se pudo subir la foto ${photo.storagePath}: ${error.message}`,
    );
  }
}

async function saveExercise(
  client: SupabaseClient,
  exercise: LibraryExercise,
): Promise<void> {
  const { error } = await client.from(EXERCISES_TABLE).upsert(
    {
      library_key: exercise.libraryKey,
      source: LIBRARY_SOURCE,
      club_id: null,
      name: exercise.name,
      tips: exercise.tips,
      youtube: null,
      image_start_path: exercise.photos[0]?.storagePath ?? null,
      image_end_path: exercise.photos[1]?.storagePath ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "library_key" },
  );
  if (error) {
    throw new Error(
      `No se pudo guardar ${exercise.libraryKey}: ${error.message}`,
    );
  }
}

export function createSupabaseExerciseLibraryStore(
  client: SupabaseClient,
): LibraryStore {
  return {
    readExercises: () => readExercises(client),
    readPhotoFingerprint: (storagePath) =>
      readPhotoFingerprint(client, storagePath),
    uploadPhoto: (photo) => uploadPhoto(client, photo),
    saveExercise: (exercise) => saveExercise(client, exercise),
  };
}
