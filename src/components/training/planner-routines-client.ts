import { z } from "zod";
import {
  TRAINING_MANAGE_MARKS_API_PATH,
  TRAINING_MANAGE_ROUTINES_API_PATH,
  trainingManageExerciseLastDoseApiPath,
  trainingManageRoutineApiPath,
  trainingManageRoutineItemsApiPath,
} from "@/lib/auth/routes";
import type {
  LastDose,
  ManagedRoutine,
  RoutineEditor,
  RoutineEditorItem,
} from "@/lib/training/club-routines";
import { SHARED_ROUTINES_FILTER } from "@/lib/training/routine-editor";
import type {
  RoutineItemDraft,
  RoutineLoadDraft,
} from "@/lib/training/routine-items";
import {
  type PlannerOutcome,
  jsonInit,
  requestAndRead,
} from "./planner-client";

/**
 * Lo que Planificar → Rutinas (#908) le pide a la API v1 de las rutinas
 * (#905) y de las marcas (#903). Nada habla con la base: la aplicación
 * nativa usará estos mismos caminos (CON-002).
 */

/** El 409 de borrar una rutina que usa la cuadrícula (#905). */
const ROUTINE_IN_USE_REASON = "routine_in_use";

/** Una marca del club, como la nombra el selector de la carga. */
export type RoutineMark = { readonly id: string; readonly name: string };

export type DeleteRoutineOutcome =
  | { readonly kind: "deleted" }
  | { readonly kind: "confirmDelete"; readonly daysUsed: number }
  | { readonly kind: "failed"; readonly reason: string | null };

const managedRoutineSchema: z.ZodType<ManagedRoutine> = z.object({
  id: z.string(),
  name: z.string(),
  cycleId: z.string().nullable(),
  colorIndex: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  daysUsed: z.number().int().nonnegative(),
});

const loadSchema: z.ZodType<RoutineLoadDraft> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("pct"), markId: z.string(), pct: z.number() }),
  z.object({ kind: z.literal("week"), markId: z.string() }),
  z.object({ kind: z.literal("text"), text: z.string() }),
]);

const editorItemSchema: z.ZodType<RoutineEditorItem> = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("section"), title: z.string() }),
    z.object({
      kind: z.literal("exercise"),
      exercise: z.object({
        id: z.string(),
        name: z.string(),
        photoUrl: z.string().nullable(),
      }),
      sets: z.number().int().nullable(),
      reps: z.string().nullable(),
      rest: z.string().nullable(),
      note: z.string().nullable(),
      load: loadSchema,
    }),
  ],
);

const lastDoseResponseSchema = z.object({
  data: z.object({
    dose: z
      .object({
        sets: z.number().int().nullable(),
        reps: z.string().nullable(),
        rest: z.string().nullable(),
        load: loadSchema,
      })
      .nullable(),
  }),
});

const routinesResponseSchema = z.object({
  data: z.object({ routines: z.array(managedRoutineSchema) }),
});

const routineResponseSchema = z.object({
  data: z.object({ routine: managedRoutineSchema }),
});

const editorResponseSchema = z.object({
  data: z.object({
    routine: managedRoutineSchema,
    items: z.array(editorItemSchema),
  }),
});

const marksResponseSchema = z.object({
  data: z.object({
    marks: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
});

const routineInUseSchema = z.object({
  error: z.object({
    reason: z.literal(ROUTINE_IN_USE_REASON),
    daysUsed: z.number().int().positive(),
  }),
});

const errorReasonSchema = z.object({
  error: z.object({ reason: z.string() }),
});

function routinesQuery(filter: string): string {
  return filter === SHARED_ROUTINES_FILTER
    ? "?scope=shared"
    : `?cycle=${encodeURIComponent(filter)}`;
}

/** Las del ciclo y después las compartidas, o solo las compartidas. */
export function loadRoutines(
  filter: string,
): Promise<PlannerOutcome<readonly ManagedRoutine[]>> {
  return requestAndRead(
    `${TRAINING_MANAGE_ROUTINES_API_PATH}${routinesQuery(filter)}`,
    undefined,
    {
      schema: routinesResponseSchema,
      pick: (response) => response.data.routines,
    },
  );
}

/** En el ciclo del filtro, o compartida si el filtro son las compartidas. */
export function createRoutine(request: {
  readonly name: string;
  readonly filter: string;
}): Promise<PlannerOutcome<ManagedRoutine>> {
  const cycleId =
    request.filter === SHARED_ROUTINES_FILTER ? null : request.filter;
  return requestAndRead(
    TRAINING_MANAGE_ROUTINES_API_PATH,
    jsonInit("POST", { name: request.name, cycleId }),
    {
      schema: routineResponseSchema,
      pick: (response) => response.data.routine,
    },
  );
}

export function renameRoutine(
  routineId: string,
  name: string,
): Promise<PlannerOutcome<ManagedRoutine>> {
  return requestAndRead(
    trainingManageRoutineApiPath(routineId),
    jsonInit("PATCH", { name }),
    {
      schema: routineResponseSchema,
      pick: (response) => response.data.routine,
    },
  );
}

export function loadRoutineEditor(
  routineId: string,
): Promise<PlannerOutcome<RoutineEditor>> {
  return requestAndRead(
    trainingManageRoutineItemsApiPath(routineId),
    undefined,
    {
      schema: editorResponseSchema,
      pick: (response) => response.data,
    },
  );
}

/** Sustituye las filas enteras; responde la rutina con su cuenta nueva. */
export function saveRoutineItems(
  routineId: string,
  items: readonly RoutineItemDraft[],
): Promise<PlannerOutcome<ManagedRoutine>> {
  return requestAndRead(
    trainingManageRoutineItemsApiPath(routineId),
    jsonInit("PUT", { items }),
    {
      schema: routineResponseSchema,
      pick: (response) => response.data.routine,
    },
  );
}

/** Lo que el club usó la última vez con el ejercicio, o nulo si nunca. */
export function loadLastDose(
  exerciseId: string,
): Promise<PlannerOutcome<LastDose | null>> {
  return requestAndRead(
    trainingManageExerciseLastDoseApiPath(exerciseId),
    undefined,
    {
      schema: lastDoseResponseSchema,
      pick: (response) => response.data.dose,
    },
  );
}

export function loadMarks(): Promise<PlannerOutcome<readonly RoutineMark[]>> {
  return requestAndRead(TRAINING_MANAGE_MARKS_API_PATH, undefined, {
    schema: marksResponseSchema,
    pick: (response) => response.data.marks,
  });
}

/** Va por su cuenta y no por `requestApi`: del 409 hace falta en cuántos
 * días se usa, que `requestApi` no guarda. */
export async function deleteRoutine(
  routineId: string,
  confirm: boolean,
): Promise<DeleteRoutineOutcome> {
  const query = confirm ? "?confirm=true" : "";
  let response: Response;
  try {
    response = await fetch(
      `${trainingManageRoutineApiPath(routineId)}${query}`,
      jsonInit("DELETE"),
    );
  } catch {
    return { kind: "failed", reason: null };
  }
  if (response.ok) {
    return { kind: "deleted" };
  }
  const payload: unknown = await response.json().catch(() => null);
  const inUse = routineInUseSchema.safeParse(payload);
  if (inUse.success) {
    return { kind: "confirmDelete", daysUsed: inUse.data.error.daysUsed };
  }
  const reason = errorReasonSchema.safeParse(payload);
  return {
    kind: "failed",
    reason: reason.success ? reason.data.error.reason : null,
  };
}
