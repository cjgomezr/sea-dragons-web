import { z } from "zod";
import {
  TRAINING_MANAGE_EXERCISES_API_PATH,
  trainingManageExerciseApiPath,
} from "@/lib/auth/routes";
import type {
  ExerciseSource,
  ManagedExercise,
  ManagedExercises,
} from "@/lib/training/club-exercises";
import { type PlannerOutcome, requestAndRead } from "./planner-client";

/**
 * Lo que Planificar → Ejercicios (#910) le pide a la API v1 de los
 * ejercicios (#903): una página de la lista y crear, cambiar y borrar uno
 * del club. Crear y cambiar van como formulario multipart, con las fotos
 * como ficheros. Nada habla con la base: la aplicación nativa usará estos
 * mismos caminos (CON-002).
 */

export type ExerciseListQuery = {
  readonly text: string;
  /** Nulo son los dos orígenes. */
  readonly source: ExerciseSource | null;
  readonly offset: number;
};

const managedExerciseSchema: z.ZodType<ManagedExercise> = z.object({
  id: z.string(),
  name: z.string(),
  source: z.enum(["library", "club"]),
  tips: z.array(z.string()),
  youtube: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("link"), url: z.string() }),
      z.object({ kind: z.literal("search"), query: z.string() }),
    ])
    .nullable(),
  thumbnailUrl: z.string().nullable(),
  photoUrls: z.object({
    start: z.string().nullable(),
    end: z.string().nullable(),
  }),
  routines: z.array(z.string()),
});

const exercisesResponseSchema = z.object({
  data: z.object({
    exercises: z.array(managedExerciseSchema),
    counts: z.object({
      library: z.number().int().nonnegative(),
      club: z.number().int().nonnegative(),
    }),
    nextOffset: z.number().int().nonnegative().nullable(),
  }),
});

const exerciseResponseSchema = z.object({ data: managedExerciseSchema });

const READ_EXERCISE = {
  schema: exerciseResponseSchema,
  pick: (response: z.infer<typeof exerciseResponseSchema>): ManagedExercise =>
    response.data,
};

export function loadExercises(
  query: ExerciseListQuery,
): Promise<PlannerOutcome<ManagedExercises>> {
  const params = new URLSearchParams({ q: query.text });
  if (query.source !== null) {
    params.set("source", query.source);
  }
  if (query.offset > 0) {
    params.set("offset", String(query.offset));
  }
  return requestAndRead(
    `${TRAINING_MANAGE_EXERCISES_API_PATH}?${params.toString()}`,
    undefined,
    {
      schema: exercisesResponseSchema,
      pick: (response) => response.data,
    },
  );
}

export function createExercise(
  form: FormData,
): Promise<PlannerOutcome<ManagedExercise>> {
  return requestAndRead(
    TRAINING_MANAGE_EXERCISES_API_PATH,
    { method: "POST", body: form },
    READ_EXERCISE,
  );
}

/** Uno del club con solo el nombre, como lo crea la fila de añadir de una
 * rutina (#909): los consejos y la foto se ponen después en Ejercicios. */
export function createNamedExercise(
  name: string,
): Promise<PlannerOutcome<ManagedExercise>> {
  const form = new FormData();
  form.append("name", name);
  return createExercise(form);
}

export function updateExercise(
  exerciseId: string,
  form: FormData,
): Promise<PlannerOutcome<ManagedExercise>> {
  return requestAndRead(
    trainingManageExerciseApiPath(exerciseId),
    { method: "PATCH", body: form },
    READ_EXERCISE,
  );
}

/** Responde 204 sin cuerpo; uno en una rutina, 409 (#903). */
export function deleteExercise(
  exerciseId: string,
): Promise<PlannerOutcome<null>> {
  return requestAndRead(
    trainingManageExerciseApiPath(exerciseId),
    { method: "DELETE" },
    { schema: z.null(), pick: () => null },
  );
}
