import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { createMembershipGateway } from "@/lib/membership/supabase-membership-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type { DoseIntensity, RoutineLoad, WeekDose } from "./training-load";
import type {
  RoutineItemRecord,
  ScheduledRoutineRecord,
  TrainingCycleRecord,
  TrainingPlanGateway,
  TrainingPlanGateways,
  TrainingWeekRecord,
} from "./training-plan";

/**
 * Adaptador entre la semana del socio (#898) y Supabase. Con la llave de
 * servicio: la puerta cerrada enseña la cabecera del ciclo, que la policy de
 * `0083_training.sql` le esconde a quien no está al día. Cada lectura filtra
 * por el club de quien llama.
 */

type Environment = Readonly<Record<string, string | undefined>>;

/** El bucket público de las fotos de los ejercicios (`0083_training.sql`). */
export const TRAINING_EXERCISE_IMAGES_BUCKET = "training-exercise-images";

const ACTIVE_STATUS = "active";

const CYCLE_COLUMNS = "id, name, event_name, event_date, start_date, weeks";

/** Lo de una semana; también lo lee Planificar (#904). */
export const WEEK_COLUMNS =
  "note, dose_sets, dose_reps, dose_intensity_kind, dose_pct, dose_text";

// Las claves se nombran: entre estas tablas hay más de un camino posible y
// PostgREST no adivina cuál.
const DAY_COLUMNS = `
  weekday, slot,
  routine:training_routines!training_cycle_days_routine_same_club_fkey (
    id, name, color_index,
    items:training_routine_items!training_routine_items_routine_same_club_fkey (
      id, position, kind, section_title, sets, reps, rest, note,
      load_kind, load_pct, load_text,
      exercise:training_exercises!training_routine_items_exercise_id_fkey (
        id, name, tips, youtube, image_start_path, image_end_path
      ),
      mark:training_marks!training_routine_items_load_mark_fkey ( id, name )
    )
  )`;

const cycleRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  event_name: z.string().nullable(),
  event_date: z.string().nullable(),
  start_date: z.string(),
  weeks: z.number().int(),
});

export const weekRowSchema = z.object({
  note: z.string().nullable(),
  dose_sets: z.number().int().nullable(),
  dose_reps: z.string().nullable(),
  dose_intensity_kind: z.enum(["none", "pct", "text"]),
  dose_pct: z.number().nullable(),
  dose_text: z.string().nullable(),
});

const markRowSchema = z.object({ id: z.string(), name: z.string() });

const itemRowSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  kind: z.enum(["exercise", "section"]),
  section_title: z.string().nullable(),
  sets: z.number().int().nullable(),
  reps: z.string().nullable(),
  rest: z.string().nullable(),
  note: z.string().nullable(),
  load_kind: z.enum(["none", "pct", "week", "text"]),
  load_pct: z.number().nullable(),
  load_text: z.string().nullable(),
  exercise: z
    .object({
      id: z.string(),
      name: z.string(),
      tips: z.array(z.string()),
      youtube: z.string().nullable(),
      image_start_path: z.string().nullable(),
      image_end_path: z.string().nullable(),
    })
    .nullable(),
  mark: markRowSchema.nullable(),
});

const dayRowsSchema = z.array(
  z.object({
    weekday: z.number().int(),
    slot: z.number().int(),
    routine: z.object({
      id: z.string(),
      name: z.string(),
      color_index: z.number().int(),
      items: z.array(itemRowSchema),
    }),
  }),
);

type ItemRow = z.infer<typeof itemRowSchema>;
type WeekRow = z.infer<typeof weekRowSchema>;

/** Lo que la base garantiza con sus `check` y aquí se comprueba igual: si
 * falta, la fila está rota y no se sirve a medias. */
function requirePresent<T>(value: T | null, context: string): T {
  if (value === null) {
    throw new Error(`${context} está incompleta.`);
  }
  return value;
}

function toRoutineLoad(row: ItemRow): RoutineLoad {
  switch (row.load_kind) {
    case "none":
      return { kind: "none" };
    case "text":
      return {
        kind: "text",
        text: requirePresent(row.load_text, `La fila de rutina ${row.id}`),
      };
    case "pct":
      return {
        kind: "pct",
        mark: requirePresent(row.mark, `La fila de rutina ${row.id}`),
        pct: requirePresent(row.load_pct, `La fila de rutina ${row.id}`),
      };
    case "week":
      return {
        kind: "week",
        mark: requirePresent(row.mark, `La fila de rutina ${row.id}`),
      };
  }
}

function toRoutineItem(row: ItemRow): RoutineItemRecord {
  if (row.kind === "section") {
    return {
      kind: "section",
      id: row.id,
      position: row.position,
      title: requirePresent(row.section_title, `La fila de rutina ${row.id}`),
    };
  }
  const exercise = requirePresent(row.exercise, `La fila de rutina ${row.id}`);
  return {
    kind: "exercise",
    id: row.id,
    position: row.position,
    exercise: {
      id: exercise.id,
      name: exercise.name,
      tips: exercise.tips,
      youtube: exercise.youtube,
      imageStartPath: exercise.image_start_path,
      imageEndPath: exercise.image_end_path,
    },
    sets: row.sets,
    reps: row.reps,
    rest: row.rest,
    note: row.note,
    load: toRoutineLoad(row),
  };
}

function toDoseIntensity(row: WeekRow): DoseIntensity {
  switch (row.dose_intensity_kind) {
    case "none":
      return { kind: "none" };
    case "pct":
      return {
        kind: "pct",
        pct: requirePresent(row.dose_pct, "La dosis de una semana"),
      };
    case "text":
      return {
        kind: "text",
        text: requirePresent(row.dose_text, "La dosis de una semana"),
      };
  }
}

/** Sin series, repeticiones ni intensidad, la semana no tiene dosis (D6). */
export function toWeekDose(row: WeekRow): WeekDose | null {
  const intensity = toDoseIntensity(row);
  if (
    row.dose_sets === null &&
    row.dose_reps === null &&
    intensity.kind === "none"
  ) {
    return null;
  }
  return { sets: row.dose_sets, reps: row.dose_reps, intensity };
}

async function findActiveCycle(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<TrainingCycleRecord | null> {
  const { data, error } = await serviceClient
    .from("training_cycles")
    .select(CYCLE_COLUMNS)
    .eq("club_id", clubId)
    .eq("status", ACTIVE_STATUS)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer el ciclo activo de ${clubId}: ${error.message}`,
    );
  }
  if (data === null) {
    return null;
  }
  const row = cycleRowSchema.parse(data);
  return {
    id: row.id,
    name: row.name,
    eventName: row.event_name,
    eventDate: row.event_date,
    startDate: row.start_date,
    weeks: row.weeks,
  };
}

type WeekQuery = Parameters<TrainingPlanGateway["findWeek"]>[0];

async function findWeekRow(
  serviceClient: SupabaseClient,
  query: WeekQuery,
): Promise<WeekRow | null> {
  const { data, error } = await serviceClient
    .from("training_cycle_weeks")
    .select(WEEK_COLUMNS)
    .eq("club_id", query.clubId)
    .eq("cycle_id", query.cycleId)
    .eq("week_no", query.week)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer la semana ${query.week} del ciclo ${query.cycleId}: ${error.message}`,
    );
  }
  return data === null ? null : weekRowSchema.parse(data);
}

async function findScheduledRoutines(
  serviceClient: SupabaseClient,
  query: WeekQuery,
): Promise<readonly ScheduledRoutineRecord[]> {
  const { data, error } = await serviceClient
    .from("training_cycle_days")
    .select(DAY_COLUMNS)
    .eq("club_id", query.clubId)
    .eq("cycle_id", query.cycleId)
    .eq("week_no", query.week);
  if (error) {
    throw new Error(
      `No se pudieron leer los días de la semana ${query.week} del ciclo ${query.cycleId}: ${error.message}`,
    );
  }
  return dayRowsSchema.parse(data).map((day) => ({
    weekday: day.weekday,
    slot: day.slot,
    routine: {
      id: day.routine.id,
      name: day.routine.name,
      colorIndex: day.routine.color_index,
      items: day.routine.items.map(toRoutineItem),
    },
  }));
}

async function findWeek(
  serviceClient: SupabaseClient,
  query: WeekQuery,
): Promise<TrainingWeekRecord> {
  const [week, days] = await Promise.all([
    findWeekRow(serviceClient, query),
    findScheduledRoutines(serviceClient, query),
  ]);
  return {
    note: week === null ? null : week.note,
    dose: week === null ? null : toWeekDose(week),
    days,
  };
}

export function createTrainingPlanGateway(
  serviceClient: SupabaseClient,
): TrainingPlanGateway {
  const bucket = serviceClient.storage.from(TRAINING_EXERCISE_IMAGES_BUCKET);
  return {
    findActiveCycle: (clubId) => findActiveCycle(serviceClient, clubId),
    findWeek: (query) => findWeek(serviceClient, query),
    // El bucket es público: la dirección se deduce de la ruta, sin llamar.
    exercisePhotoUrl: (path) => bucket.getPublicUrl(path).data.publicUrl,
  };
}

export function createTrainingPlanGateways(
  serviceClient: SupabaseClient,
): TrainingPlanGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    membership: createMembershipGateway(serviceClient),
    plan: createTrainingPlanGateway(serviceClient),
  };
}

export type TrainingPlanGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: TrainingPlanGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

export function createSupabaseTrainingPlanGateways(
  env: Environment,
): TrainingPlanGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createTrainingPlanGateways(createServiceRoleClient(env)),
  };
}
