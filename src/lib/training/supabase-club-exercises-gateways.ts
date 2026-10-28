import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  ClubExerciseRow,
  ClubExercisesGateway,
  ClubExercisesGateways,
  ExerciseDeleteResult,
  ExercisePhotosGateway,
  ExerciseRecord,
  ExerciseWriteResult,
} from "./club-exercises";
import { TRAINING_EXERCISE_IMAGES_BUCKET } from "./supabase-training-plan-gateways";

/**
 * Los ejercicios de Planificar contra Supabase (#903): `training_exercises`,
 * las funciones de `0084_training_manage.sql` y el bucket público de las
 * fotos. Con la llave de servicio, como todo lo que escribe Entrenamiento
 * (D4); cada escritura filtra por el club de quien llama.
 */

type Environment = Readonly<Record<string, string | undefined>>;

const EXERCISES_TABLE = "training_exercises";
const ROUTINE_ITEMS_TABLE = "training_routine_items";
const SEARCH_FUNCTION = "search_training_exercises";
const NAME_TAKEN_FUNCTION = "training_exercise_name_taken";
const UNIQUE_VIOLATION_CODE = "23505";
const FOREIGN_KEY_VIOLATION_CODE = "23503";
const CLUB_SOURCE = "club";

const EXERCISE_COLUMNS =
  "id, club_id, name, tips, youtube, image_start_path, image_end_path";

/** Una foto cambiada vuelve a la misma ruta (`{0|1}.{ext}`): una caché de
 * una hora, la de Storage por defecto, seguiría sirviendo la de antes. */
const PHOTO_CACHE_SECONDS = "60";

const exerciseRowSchema = z.object({
  id: z.string(),
  club_id: z.string().nullable(),
  name: z.string(),
  tips: z.array(z.string()),
  youtube: z.string().nullable(),
  image_start_path: z.string().nullable(),
  image_end_path: z.string().nullable(),
});

const routineNameRowsSchema = z.array(
  z.object({
    exercise_id: z.string(),
    training_routines: z.object({ name: z.string() }),
  }),
);

function toRecord(row: z.infer<typeof exerciseRowSchema>): ExerciseRecord {
  return {
    id: row.id,
    clubId: row.club_id,
    name: row.name,
    tips: row.tips,
    youtube: row.youtube,
    imageStartPath: row.image_start_path,
    imageEndPath: row.image_end_path,
  };
}

function toWritableColumns(row: ClubExerciseRow) {
  return {
    name: row.name,
    tips: row.tips,
    youtube: row.youtube,
    image_start_path: row.imageStartPath,
    image_end_path: row.imageEndPath,
  };
}

async function searchExercises(
  serviceClient: SupabaseClient,
  query: Parameters<ClubExercisesGateway["searchExercises"]>[0],
): Promise<readonly ExerciseRecord[]> {
  const { data, error } = await serviceClient
    .rpc(SEARCH_FUNCTION, {
      p_club_id: query.clubId,
      p_text: query.text,
      p_limit: query.limit,
    })
    .select(EXERCISE_COLUMNS);
  if (error) {
    throw new Error(
      `No se pudieron buscar ejercicios en el club ${query.clubId}: ${error.message}`,
    );
  }
  return z.array(exerciseRowSchema).parse(data).map(toRecord);
}

async function findExercise(
  serviceClient: SupabaseClient,
  exerciseId: string,
): Promise<ExerciseRecord | null> {
  const { data, error } = await serviceClient
    .from(EXERCISES_TABLE)
    .select(EXERCISE_COLUMNS)
    .eq("id", exerciseId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer el ejercicio ${exerciseId}: ${error.message}`,
    );
  }
  return data === null ? null : toRecord(exerciseRowSchema.parse(data));
}

async function isNameTaken(
  serviceClient: SupabaseClient,
  query: Parameters<ClubExercisesGateway["isNameTaken"]>[0],
): Promise<boolean> {
  const { data, error } = await serviceClient.rpc(NAME_TAKEN_FUNCTION, {
    p_club_id: query.clubId,
    p_name: query.name,
    p_except_id: query.exceptId,
  });
  if (error) {
    throw new Error(
      `No se pudo comprobar el nombre del ejercicio en el club ${query.clubId}: ${error.message}`,
    );
  }
  return z.boolean().parse(data);
}

/** Sin repetir y por orden alfabético: "en Strength A, Strength B". */
function groupRoutineNames(
  rows: z.infer<typeof routineNameRowsSchema>,
): ReadonlyMap<string, readonly string[]> {
  const namesById = new Map<string, Set<string>>();
  for (const row of rows) {
    const names = namesById.get(row.exercise_id) ?? new Set<string>();
    names.add(row.training_routines.name);
    namesById.set(row.exercise_id, names);
  }
  return new Map(
    [...namesById].map(([id, names]) => [
      id,
      [...names].sort((one, other) => one.localeCompare(other)),
    ]),
  );
}

async function listRoutineNames(
  serviceClient: SupabaseClient,
  query: Parameters<ClubExercisesGateway["listRoutineNames"]>[0],
): Promise<ReadonlyMap<string, readonly string[]>> {
  if (query.exerciseIds.length === 0) {
    return new Map();
  }
  const { data, error } = await serviceClient
    .from(ROUTINE_ITEMS_TABLE)
    .select("exercise_id, training_routines(name)")
    .eq("club_id", query.clubId)
    .in("exercise_id", [...query.exerciseIds]);
  if (error) {
    throw new Error(
      `No se pudieron leer las rutinas de los ejercicios del club ${query.clubId}: ${error.message}`,
    );
  }
  return groupRoutineNames(routineNameRowsSchema.parse(data));
}

async function insertExercise(
  serviceClient: SupabaseClient,
  row: ClubExerciseRow,
): Promise<ExerciseWriteResult> {
  const { error } = await serviceClient.from(EXERCISES_TABLE).insert({
    id: row.id,
    club_id: row.clubId,
    source: CLUB_SOURCE,
    ...toWritableColumns(row),
  });
  if (error?.code === UNIQUE_VIOLATION_CODE) {
    return { kind: "name_taken" };
  }
  if (error) {
    throw new Error(
      `No se pudo crear el ejercicio en el club ${row.clubId}: ${error.message}`,
    );
  }
  return { kind: "saved" };
}

async function updateExercise(
  serviceClient: SupabaseClient,
  row: ClubExerciseRow,
): Promise<ExerciseWriteResult> {
  const { data, error } = await serviceClient
    .from(EXERCISES_TABLE)
    .update({ ...toWritableColumns(row), updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("club_id", row.clubId)
    .select("id");
  if (error?.code === UNIQUE_VIOLATION_CODE) {
    return { kind: "name_taken" };
  }
  if (error) {
    throw new Error(
      `No se pudo guardar el ejercicio ${row.id}: ${error.message}`,
    );
  }
  return data.length === 0 ? { kind: "not_found" } : { kind: "saved" };
}

async function deleteExercise(
  serviceClient: SupabaseClient,
  target: Parameters<ClubExercisesGateway["deleteExercise"]>[0],
): Promise<ExerciseDeleteResult> {
  const { error } = await serviceClient
    .from(EXERCISES_TABLE)
    .delete()
    .eq("id", target.exerciseId)
    .eq("club_id", target.clubId);
  if (error?.code === FOREIGN_KEY_VIOLATION_CODE) {
    return { kind: "in_use" };
  }
  if (error) {
    throw new Error(
      `No se pudo borrar el ejercicio ${target.exerciseId}: ${error.message}`,
    );
  }
  return { kind: "deleted" };
}

function createExercisePhotosGateway(
  serviceClient: SupabaseClient,
): ExercisePhotosGateway {
  const bucket = serviceClient.storage.from(TRAINING_EXERCISE_IMAGES_BUCKET);
  return {
    async upload(photo) {
      const { error } = await bucket.upload(photo.storagePath, photo.bytes, {
        contentType: photo.contentType,
        cacheControl: PHOTO_CACHE_SECONDS,
        upsert: true,
      });
      if (error) {
        throw new Error(
          `No se pudo subir la foto ${photo.storagePath}: ${error.message}`,
        );
      }
    },

    async remove(storagePaths) {
      const listed = storagePaths.join(", ");
      const { data, error } = await bucket.remove([...storagePaths]);
      if (error) {
        throw new Error(
          `No se pudieron borrar las fotos ${listed}: ${error.message}`,
        );
      }
      // Storage responde bien aunque no haya borrado nada: una lista más
      // corta es la única señal de que algún fichero sigue ahí.
      if (data.length < storagePaths.length) {
        throw new Error(`Storage no borró todas las fotos ${listed}.`);
      }
    },

    // El bucket es público: la dirección se deduce de la ruta, sin llamar.
    publicUrl: (storagePath) => bucket.getPublicUrl(storagePath).data.publicUrl,
  };
}

export function createClubExercisesGateways(
  serviceClient: SupabaseClient,
): ClubExercisesGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    exercises: {
      searchExercises: (query) => searchExercises(serviceClient, query),
      findExercise: (exerciseId) => findExercise(serviceClient, exerciseId),
      isNameTaken: (query) => isNameTaken(serviceClient, query),
      listRoutineNames: (query) => listRoutineNames(serviceClient, query),
      insertExercise: (row) => insertExercise(serviceClient, row),
      updateExercise: (row) => updateExercise(serviceClient, row),
      deleteExercise: (target) => deleteExercise(serviceClient, target),
    },
    photos: createExercisePhotosGateway(serviceClient),
    audit: createSupabaseAuditLogWriter(serviceClient),
    newExerciseId: () => randomUUID(),
  };
}

export type ClubExercisesGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: ClubExercisesGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

export function createSupabaseClubExercisesGateways(
  env: Environment,
): ClubExercisesGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createClubExercisesGateways(createServiceRoleClient(env)),
  };
}
