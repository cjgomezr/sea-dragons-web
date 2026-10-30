import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  ClubRoutinesGateway,
  ClubRoutinesGateways,
  LastDose,
  ManagedRoutine,
  RoutineDeleteResult,
  RoutineEditorItem,
  RoutineInsertResult,
  RoutineItemsReplaceResult,
  RoutineTarget,
} from "./club-routines";
import type { RoutineItemDraft, RoutineLoadDraft } from "./routine-items";
import { TRAINING_EXERCISE_IMAGES_BUCKET } from "./supabase-training-plan-gateways";

/**
 * Las rutinas de Planificar contra Supabase (#905), con la llave de servicio
 * como todo lo que escribe Entrenamiento (D4). Cada consulta filtra por el
 * club de quien llama. Las cuentas, sustituir las filas y borrar son
 * funciones de `0086_training_routines_manage.sql`.
 */

type Environment = Readonly<Record<string, string | undefined>>;

const CYCLES_TABLE = "training_cycles";
const ROUTINES_TABLE = "training_routines";
const ITEMS_TABLE = "training_routine_items";
const EXERCISES_TABLE = "training_exercises";
const MARKS_TABLE = "training_marks";
const OVERVIEW_FUNCTION = "training_routine_overview";
const FOREIGN_KEY_VIOLATION_CODE = "23503";

const overviewRowsSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    cycle_id: z.string().nullable(),
    color_index: z.number().int(),
    item_count: z.number().int(),
    days_used: z.number().int(),
  }),
);

const idRowsSchema = z.array(z.object({ id: z.string() }));

const deleteRowsSchema = z.array(
  z.object({ deleted: z.boolean(), days_used: z.number().int() }),
);

const doseRowSchema = z.object({
  sets: z.number().int().nullable(),
  reps: z.string().nullable(),
  rest: z.string().nullable(),
  load_kind: z.enum(["none", "pct", "week", "text"]),
  load_mark_id: z.string().nullable(),
  load_pct: z.number().nullable(),
  load_text: z.string().nullable(),
});

type DoseRow = z.infer<typeof doseRowSchema>;

// La clave se nombra: PostgREST no adivina entre los caminos posibles.
const EDITOR_ITEM_COLUMNS = `
  kind, section_title, sets, reps, rest, note,
  load_kind, load_mark_id, load_pct, load_text,
  exercise:training_exercises!training_routine_items_exercise_id_fkey (
    id, name, image_start_path
  )`;

const editorItemRowsSchema = z.array(
  doseRowSchema.extend({
    kind: z.enum(["exercise", "section"]),
    section_title: z.string().nullable(),
    note: z.string().nullable(),
    exercise: z
      .object({
        id: z.string(),
        name: z.string(),
        image_start_path: z.string().nullable(),
      })
      .nullable(),
  }),
);

type EditorItemRow = z.infer<typeof editorItemRowsSchema>[number];

function failure(action: string, message: string): Error {
  return new Error(`No se pudo ${action}: ${message}`);
}

function toManagedRoutine(
  row: z.infer<typeof overviewRowsSchema>[number],
): ManagedRoutine {
  return {
    id: row.id,
    name: row.name,
    cycleId: row.cycle_id,
    colorIndex: row.color_index,
    itemCount: row.item_count,
    daysUsed: row.days_used,
  };
}

/** Lo que la base garantiza con sus `check` y aquí se comprueba igual: si
 * falta, la fila está rota y no se sirve a medias. */
function requirePresent<T>(value: T | null, context: string): T {
  if (value === null) {
    throw new Error(`${context} está incompleta.`);
  }
  return value;
}

function toLoadDraft(row: DoseRow, context: string): RoutineLoadDraft {
  switch (row.load_kind) {
    case "none":
      return { kind: "none" };
    case "text":
      return { kind: "text", text: requirePresent(row.load_text, context) };
    case "pct":
      return {
        kind: "pct",
        markId: requirePresent(row.load_mark_id, context),
        pct: requirePresent(row.load_pct, context),
      };
    case "week":
      return {
        kind: "week",
        markId: requirePresent(row.load_mark_id, context),
      };
  }
}

/** Las columnas de una fila, como las lee `replace_training_routine_items`. */
function toItemColumns(item: RoutineItemDraft): Record<string, unknown> {
  if (item.kind === "section") {
    return { kind: "section", section_title: item.title, load_kind: "none" };
  }
  const { load } = item;
  return {
    kind: "exercise",
    exercise_id: item.exerciseId,
    sets: item.sets,
    reps: item.reps,
    rest: item.rest,
    note: item.note,
    load_kind: load.kind,
    load_mark_id:
      load.kind === "pct" || load.kind === "week" ? load.markId : null,
    load_pct: load.kind === "pct" ? load.pct : null,
    load_text: load.kind === "text" ? load.text : null,
  };
}

async function cycleExists(
  serviceClient: SupabaseClient,
  target: { readonly clubId: string; readonly cycleId: string },
): Promise<boolean> {
  const { data, error } = await serviceClient
    .from(CYCLES_TABLE)
    .select("id")
    .eq("id", target.cycleId)
    .eq("club_id", target.clubId)
    .maybeSingle();
  if (error) {
    throw failure(`leer el ciclo ${target.cycleId}`, error.message);
  }
  return data !== null;
}

async function listRoutines(
  serviceClient: SupabaseClient,
  clubId: string,
  cycleId: string | null,
): Promise<readonly ManagedRoutine[]> {
  const overview = serviceClient.rpc(OVERVIEW_FUNCTION, { p_club_id: clubId });
  const { data, error } = await (cycleId === null
    ? overview.is("cycle_id", null)
    : overview.eq("cycle_id", cycleId));
  if (error) {
    throw failure(`leer las rutinas del club ${clubId}`, error.message);
  }
  return overviewRowsSchema.parse(data).map(toManagedRoutine);
}

async function findRoutine(
  serviceClient: SupabaseClient,
  target: RoutineTarget,
): Promise<ManagedRoutine | null> {
  const { data, error } = await serviceClient
    .rpc(OVERVIEW_FUNCTION, { p_club_id: target.clubId })
    .eq("id", target.routineId);
  if (error) {
    throw failure(`leer la rutina ${target.routineId}`, error.message);
  }
  const [row] = overviewRowsSchema.parse(data);
  return row === undefined ? null : toManagedRoutine(row);
}

async function insertRoutine(
  serviceClient: SupabaseClient,
  row: Parameters<ClubRoutinesGateway["insertRoutine"]>[0],
): Promise<RoutineInsertResult> {
  const { data, error } = await serviceClient
    .from(ROUTINES_TABLE)
    .insert({
      club_id: row.clubId,
      cycle_id: row.cycleId,
      name: row.name,
      color_index: row.colorIndex,
    })
    .select("id")
    .single();
  // El ciclo se borró entretanto.
  if (error?.code === FOREIGN_KEY_VIOLATION_CODE) {
    return { kind: "cycle_not_found" };
  }
  if (error) {
    throw failure(`crear la rutina en el club ${row.clubId}`, error.message);
  }
  return {
    kind: "created",
    routineId: z.object({ id: z.string() }).parse(data).id,
  };
}

async function renameRoutine(
  serviceClient: SupabaseClient,
  target: RoutineTarget,
  name: string,
): Promise<boolean> {
  const { data, error } = await serviceClient
    .from(ROUTINES_TABLE)
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", target.routineId)
    .eq("club_id", target.clubId)
    .select("id");
  if (error) {
    throw failure(`renombrar la rutina ${target.routineId}`, error.message);
  }
  return data.length > 0;
}

async function deleteRoutine(
  serviceClient: SupabaseClient,
  target: RoutineTarget,
  confirm: boolean,
): Promise<RoutineDeleteResult> {
  const { data, error } = await serviceClient.rpc("delete_training_routine", {
    p_club_id: target.clubId,
    p_routine_id: target.routineId,
    p_confirm: confirm,
  });
  if (error) {
    throw failure(`borrar la rutina ${target.routineId}`, error.message);
  }
  const [row] = deleteRowsSchema.parse(data);
  if (row === undefined) {
    return { kind: "not_found" };
  }
  return row.deleted
    ? { kind: "deleted", daysCleared: row.days_used }
    : { kind: "in_use", daysUsed: row.days_used };
}

async function findKnownExercises(
  serviceClient: SupabaseClient,
  clubId: string,
  exerciseIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (exerciseIds.length === 0) {
    return new Set();
  }
  const { data, error } = await serviceClient
    .from(EXERCISES_TABLE)
    .select("id")
    .in("id", [...exerciseIds])
    .or(`club_id.is.null,club_id.eq.${clubId}`);
  if (error) {
    throw failure("leer los ejercicios de las filas", error.message);
  }
  return new Set(idRowsSchema.parse(data).map((row) => row.id));
}

async function findKnownMarks(
  serviceClient: SupabaseClient,
  clubId: string,
  markIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (markIds.length === 0) {
    return new Set();
  }
  const { data, error } = await serviceClient
    .from(MARKS_TABLE)
    .select("id")
    .in("id", [...markIds])
    .eq("club_id", clubId);
  if (error) {
    throw failure("leer las marcas de las filas", error.message);
  }
  return new Set(idRowsSchema.parse(data).map((row) => row.id));
}

async function findUnknownReferences(
  serviceClient: SupabaseClient,
  clubId: string,
  ids: Parameters<ClubRoutinesGateway["findUnknownReferences"]>[1],
): ReturnType<ClubRoutinesGateway["findUnknownReferences"]> {
  const [exercises, marks] = await Promise.all([
    findKnownExercises(serviceClient, clubId, ids.exerciseIds),
    findKnownMarks(serviceClient, clubId, ids.markIds),
  ]);
  return {
    exerciseIds: ids.exerciseIds.filter((id) => !exercises.has(id)),
    markIds: ids.markIds.filter((id) => !marks.has(id)),
  };
}

async function replaceItems(
  serviceClient: SupabaseClient,
  target: RoutineTarget,
  items: readonly RoutineItemDraft[],
): Promise<RoutineItemsReplaceResult> {
  const { data, error } = await serviceClient.rpc(
    "replace_training_routine_items",
    {
      p_club_id: target.clubId,
      p_routine_id: target.routineId,
      p_items: items.map(toItemColumns),
    },
  );
  // Un ejercicio o una marca que se borró después de comprobarlos.
  if (error?.code === FOREIGN_KEY_VIOLATION_CODE) {
    return { kind: "stale_reference" };
  }
  if (error) {
    throw failure(
      `guardar las filas de la rutina ${target.routineId}`,
      error.message,
    );
  }
  return z.boolean().parse(data) ? { kind: "replaced" } : { kind: "not_found" };
}

async function exerciseVisible(
  serviceClient: SupabaseClient,
  clubId: string,
  exerciseId: string,
): Promise<boolean> {
  const known = await findKnownExercises(serviceClient, clubId, [exerciseId]);
  return known.has(exerciseId);
}

/** La fila guardada más reciente; en la misma rutina, la de más abajo. */
async function findLastDose(
  serviceClient: SupabaseClient,
  clubId: string,
  exerciseId: string,
): Promise<LastDose | null> {
  const { data, error } = await serviceClient
    .from(ITEMS_TABLE)
    .select("sets, reps, rest, load_kind, load_mark_id, load_pct, load_text")
    .eq("club_id", clubId)
    .eq("exercise_id", exerciseId)
    .order("saved_at", { ascending: false })
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw failure(
      `leer la última dosis del ejercicio ${exerciseId}`,
      error.message,
    );
  }
  if (data === null) {
    return null;
  }
  const row = doseRowSchema.parse(data);
  return {
    sets: row.sets,
    reps: row.reps,
    rest: row.rest,
    load: toLoadDraft(row, "La última fila del ejercicio"),
  };
}

function toEditorItem(
  row: EditorItemRow,
  photoUrl: (path: string) => string,
): RoutineEditorItem {
  const context = "Una fila de la rutina";
  if (row.kind === "section") {
    return {
      kind: "section",
      title: requirePresent(row.section_title, context),
    };
  }
  const exercise = requirePresent(row.exercise, context);
  return {
    kind: "exercise",
    exercise: {
      id: exercise.id,
      name: exercise.name,
      photoUrl:
        exercise.image_start_path === null
          ? null
          : photoUrl(exercise.image_start_path),
    },
    sets: row.sets,
    reps: row.reps,
    rest: row.rest,
    note: row.note,
    load: toLoadDraft(row, context),
  };
}

async function listItems(
  serviceClient: SupabaseClient,
  target: RoutineTarget,
): Promise<readonly RoutineEditorItem[]> {
  const { data, error } = await serviceClient
    .from(ITEMS_TABLE)
    .select(EDITOR_ITEM_COLUMNS)
    .eq("club_id", target.clubId)
    .eq("routine_id", target.routineId)
    .order("position");
  if (error) {
    throw failure(
      `leer las filas de la rutina ${target.routineId}`,
      error.message,
    );
  }
  const bucket = serviceClient.storage.from(TRAINING_EXERCISE_IMAGES_BUCKET);
  // El bucket es público: la dirección se deduce de la ruta, sin llamar.
  const photoUrl = (path: string): string =>
    bucket.getPublicUrl(path).data.publicUrl;
  return editorItemRowsSchema
    .parse(data)
    .map((row) => toEditorItem(row, photoUrl));
}

export function createClubRoutinesGateways(
  serviceClient: SupabaseClient,
): ClubRoutinesGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    routines: {
      cycleExists: (target) => cycleExists(serviceClient, target),
      listRoutines: (clubId, cycleId) =>
        listRoutines(serviceClient, clubId, cycleId),
      findRoutine: (target) => findRoutine(serviceClient, target),
      insertRoutine: (row) => insertRoutine(serviceClient, row),
      renameRoutine: (target, name) =>
        renameRoutine(serviceClient, target, name),
      deleteRoutine: (target, confirm) =>
        deleteRoutine(serviceClient, target, confirm),
      findUnknownReferences: (clubId, ids) =>
        findUnknownReferences(serviceClient, clubId, ids),
      replaceItems: (target, items) =>
        replaceItems(serviceClient, target, items),
      exerciseVisible: (clubId, exerciseId) =>
        exerciseVisible(serviceClient, clubId, exerciseId),
      findLastDose: (clubId, exerciseId) =>
        findLastDose(serviceClient, clubId, exerciseId),
      listItems: (target) => listItems(serviceClient, target),
    },
    audit: createSupabaseAuditLogWriter(serviceClient),
  };
}

export type ClubRoutinesGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: ClubRoutinesGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

export function createSupabaseClubRoutinesGateways(
  env: Environment,
): ClubRoutinesGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createClubRoutinesGateways(createServiceRoleClient(env)),
  };
}
