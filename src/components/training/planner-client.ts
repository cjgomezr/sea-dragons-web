import { z } from "zod";
import {
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import {
  TRAINING_MANAGE_CYCLES_API_PATH,
  TRAINING_MANAGE_ROUTINES_API_PATH,
  trainingManageCycleActionApiPath,
  trainingManageCycleWeekClearApiPath,
  trainingManageCycleApiPath,
} from "@/lib/auth/routes";
import type {
  ConflictingCycle,
  CycleChanges,
  CycleDayChange,
  CycleDayRecord,
  CycleInput,
  CycleWeekRecord,
  ManagedCycle,
} from "@/lib/training/club-cycles";
import type { ManagedRoutine } from "@/lib/training/club-routines";

/**
 * Lo que Planificar → Ciclo (#906) le pide a la API v1 de los ciclos (#904).
 * Nada habla con la base: la aplicación nativa usará estos mismos caminos
 * (CON-002).
 */

/** El 409 de bajar las semanas cuando las que sobran tienen días (#904). */
const DAYS_WOULD_BE_REMOVED_REASON = "cycle_days_would_be_removed";

/** El 409 de activar algo que choca con otros activos (#978). */
const CYCLE_CONFLICTS_REASON = "cycle_conflicts";

const CONFIRM_QUERY = "confirm=true";

const managedCycleSchema: z.ZodType<ManagedCycle> = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["draft", "active", "archived"]),
  weeks: z.number().int().positive(),
  startDate: z.iso.date(),
  event: z.object({ name: z.string(), date: z.iso.date() }).nullable(),
  ownRoutines: z.number().int().nonnegative(),
  // Para quién es (#978), que Planificar enseña y cambia (#980).
  audience: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("club") }),
    z.object({
      kind: z.literal("groups"),
      groups: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  ]),
});

const cyclesResponseSchema = z.object({
  data: z.object({ cycles: z.array(managedCycleSchema) }),
});

/** Un ciclo con sus semanas y su cuadrícula: los campos leen el ciclo. */
const cycleDetailResponseSchema = z.object({
  data: z.object({ cycle: managedCycleSchema }),
});

const weekDoseSchema = z.object({
  sets: z.number().int().nullable(),
  reps: z.string().nullable(),
  intensity: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }),
    z.object({ kind: z.literal("pct"), pct: z.number() }),
    z.object({ kind: z.literal("text"), text: z.string() }),
  ]),
});

const cycleWeekSchema: z.ZodType<CycleWeekRecord> = z.object({
  weekNo: z.number().int().positive(),
  note: z.string().nullable(),
  dose: weekDoseSchema.nullable(),
});

const cycleDaySchema: z.ZodType<CycleDayRecord> = z.object({
  weekNo: z.number().int().positive(),
  weekday: z.number().int().nonnegative(),
  slot: z.union([z.literal(1), z.literal(2)]),
  routineId: z.string(),
});

/** La cuadrícula: las semanas con su nota y su dosis, y los días. */
const cyclePlanResponseSchema = z.object({
  data: z.object({
    weeks: z.array(cycleWeekSchema),
    days: z.array(cycleDaySchema),
  }),
});

const managedRoutineSchema: z.ZodType<ManagedRoutine> = z.object({
  id: z.string(),
  name: z.string(),
  cycleId: z.string().nullable(),
  colorIndex: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  daysUsed: z.number().int().nonnegative(),
});

const routinesResponseSchema = z.object({
  data: z.object({ routines: z.array(managedRoutineSchema) }),
});

const duplicatedResponseSchema = z.object({
  data: z.object({
    cycles: z.array(managedCycleSchema),
    duplicatedCycleId: z.string(),
    routinesCopied: z.number().int().nonnegative(),
  }),
});

const daysWouldBeRemovedSchema = z.object({
  error: z.object({
    reason: z.literal(DAYS_WOULD_BE_REMOVED_REASON),
    daysRemoved: z.number().int().positive(),
  }),
});

/** El 409 de activar, o de cambiar los grupos de un activo, cuando choca con
 * otros activos (#978): qué ciclos se archivarían. */
const cycleConflictsSchema = z.object({
  error: z.object({
    reason: z.literal(CYCLE_CONFLICTS_REASON),
    conflicts: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
});

/** El motivo de cualquier otro error de la convención. */
const errorReasonSchema = z.object({
  error: z.object({ reason: z.string() }),
});

/** Por qué no salió: el `reason` del error, si lo trae, elige la frase. */
export type PlannerFailure = {
  readonly kind: "failed";
  readonly reason: string | null;
};

export type PlannerOutcome<Value> =
  { readonly kind: "ok"; readonly value: Value } | PlannerFailure;

export type CycleList = readonly ManagedCycle[];

/** Lo que pinta la cuadrícula de un ciclo (#907). */
export type CyclePlan = {
  readonly weeks: readonly CycleWeekRecord[];
  readonly days: readonly CycleDayRecord[];
};

export type DuplicateOutcome = {
  readonly cycles: CycleList;
  readonly duplicatedCycleId: string;
  readonly routinesCopied: number;
};

/** Los activos que se archivarían al confirmar (D3 de E38). */
export type CycleConflicts = {
  readonly kind: "conflicts";
  readonly conflicts: readonly ConflictingCycle[];
};

/** Un cambio puede pedir confirmar antes de quitar días con rutina, o antes
 * de archivar los activos con los que choca. */
export type CycleUpdateOutcome =
  | PlannerOutcome<ManagedCycle>
  | { readonly kind: "confirmRemoval"; readonly daysRemoved: number }
  | CycleConflicts;

export type ActivateOutcome = PlannerOutcome<CycleList> | CycleConflicts;

type CyclePayload = {
  readonly kind: "payload";
  readonly isOk: boolean;
  readonly payload: unknown;
};

export async function requestAndRead<Value, Read>(
  path: string,
  init: RequestInit | undefined,
  read: {
    readonly schema: z.ZodType<Value>;
    readonly pick: (value: Value) => Read;
  },
): Promise<PlannerOutcome<Read>> {
  const outcome = readApiPayload(await requestApi(path, init), read.schema);
  return outcome.kind === "ok"
    ? { kind: "ok", value: read.pick(outcome.value) }
    : { kind: "failed", reason: outcome.reason };
}

export function jsonInit(method: string, body?: unknown): RequestInit {
  return body === undefined
    ? { method }
    : { method, headers: JSON_REQUEST_HEADERS, body: JSON.stringify(body) };
}

export function loadCycles(): Promise<PlannerOutcome<CycleList>> {
  return requestAndRead(TRAINING_MANAGE_CYCLES_API_PATH, undefined, {
    schema: cyclesResponseSchema,
    pick: (response) => response.data.cycles,
  });
}

export function createCycle(
  input: CycleInput,
): Promise<PlannerOutcome<ManagedCycle>> {
  return requestAndRead(
    TRAINING_MANAGE_CYCLES_API_PATH,
    jsonInit("POST", input),
    {
      schema: cycleDetailResponseSchema,
      pick: (response) => response.data.cycle,
    },
  );
}

/** Va por su cuenta y no por `requestApi`: de un 409 hacen falta sus
 * detalles (cuántos días se perderían, qué ciclos chocan), que `requestApi`
 * no guarda. */
async function sendForPayload(
  path: string,
  init: RequestInit,
): Promise<CyclePayload | PlannerFailure> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    return { kind: "failed", reason: null };
  }
  const payload: unknown = await response.json().catch(() => null);
  return { kind: "payload", isOk: response.ok, payload };
}

function readConflicts(payload: unknown): CycleConflicts | null {
  const conflicts = cycleConflictsSchema.safeParse(payload);
  return conflicts.success
    ? { kind: "conflicts", conflicts: conflicts.data.error.conflicts }
    : null;
}

function readFailure(payload: unknown): PlannerFailure {
  const reason = errorReasonSchema.safeParse(payload);
  return {
    kind: "failed",
    reason: reason.success ? reason.data.error.reason : null,
  };
}

/** `?confirm=true` archiva los que chocan (#978); sin él, la API sólo dice
 * cuáles son. */
function confirmedPath(path: string, confirmConflicts: boolean): string {
  return confirmConflicts ? `${path}?${CONFIRM_QUERY}` : path;
}

export async function updateCycle(
  cycleId: string,
  request: {
    readonly changes: CycleChanges;
    readonly confirmRemoval: boolean;
    readonly confirmConflicts: boolean;
  },
): Promise<CycleUpdateOutcome> {
  const body = request.confirmRemoval
    ? { ...request.changes, confirmRemoval: true }
    : request.changes;
  const sent = await sendForPayload(
    confirmedPath(
      trainingManageCycleApiPath(cycleId),
      request.confirmConflicts,
    ),
    jsonInit("PATCH", body),
  );
  if (sent.kind === "failed") {
    return sent;
  }
  if (sent.isOk) {
    const parsed = cycleDetailResponseSchema.safeParse(sent.payload);
    return parsed.success
      ? { kind: "ok", value: parsed.data.data.cycle }
      : { kind: "failed", reason: null };
  }
  const removal = daysWouldBeRemovedSchema.safeParse(sent.payload);
  if (removal.success) {
    return {
      kind: "confirmRemoval",
      daysRemoved: removal.data.error.daysRemoved,
    };
  }
  return readConflicts(sent.payload) ?? readFailure(sent.payload);
}

export async function activateCycle(
  cycleId: string,
  confirmConflicts: boolean,
): Promise<ActivateOutcome> {
  const sent = await sendForPayload(
    confirmedPath(
      trainingManageCycleActionApiPath(cycleId, "activate"),
      confirmConflicts,
    ),
    jsonInit("POST"),
  );
  if (sent.kind === "failed") {
    return sent;
  }
  if (sent.isOk) {
    const parsed = cyclesResponseSchema.safeParse(sent.payload);
    return parsed.success
      ? { kind: "ok", value: parsed.data.data.cycles }
      : { kind: "failed", reason: null };
  }
  return readConflicts(sent.payload) ?? readFailure(sent.payload);
}

export function archiveCycle(
  cycleId: string,
): Promise<PlannerOutcome<CycleList>> {
  return requestAndRead(
    trainingManageCycleActionApiPath(cycleId, "archive"),
    jsonInit("POST"),
    { schema: cyclesResponseSchema, pick: (response) => response.data.cycles },
  );
}

/** Sólo un borrador o un archivado (#935); el activo responde 409. */
export function deleteCycle(
  cycleId: string,
): Promise<PlannerOutcome<CycleList>> {
  return requestAndRead(
    trainingManageCycleApiPath(cycleId),
    jsonInit("DELETE"),
    { schema: cyclesResponseSchema, pick: (response) => response.data.cycles },
  );
}

export function duplicateCycle(
  cycleId: string,
): Promise<PlannerOutcome<DuplicateOutcome>> {
  return requestAndRead(
    trainingManageCycleActionApiPath(cycleId, "duplicate"),
    jsonInit("POST"),
    { schema: duplicatedResponseSchema, pick: (response) => response.data },
  );
}

function readCyclePlan(
  response: z.infer<typeof cyclePlanResponseSchema>,
): CyclePlan {
  return { weeks: response.data.weeks, days: response.data.days };
}

export function loadCyclePlan(
  cycleId: string,
): Promise<PlannerOutcome<CyclePlan>> {
  return requestAndRead(trainingManageCycleApiPath(cycleId), undefined, {
    schema: cyclePlanResponseSchema,
    pick: readCyclePlan,
  });
}

/** Las del ciclo y después las compartidas, en el orden de la API (#905). */
export function loadCycleRoutines(
  cycleId: string,
): Promise<PlannerOutcome<readonly ManagedRoutine[]>> {
  const query = new URLSearchParams({ cycle: cycleId });
  return requestAndRead(
    `${TRAINING_MANAGE_ROUTINES_API_PATH}?${query.toString()}`,
    undefined,
    {
      schema: routinesResponseSchema,
      pick: (response) => response.data.routines,
    },
  );
}

export function setCycleDay(
  cycleId: string,
  change: CycleDayChange,
): Promise<PlannerOutcome<CyclePlan>> {
  return requestAndRead(
    trainingManageCycleActionApiPath(cycleId, "days"),
    jsonInit("PUT", change),
    { schema: cyclePlanResponseSchema, pick: readCyclePlan },
  );
}

export function saveCycleWeek(
  cycleId: string,
  week: CycleWeekRecord,
): Promise<PlannerOutcome<CyclePlan>> {
  return requestAndRead(
    trainingManageCycleActionApiPath(cycleId, "weeks"),
    jsonInit("PUT", week),
    { schema: cyclePlanResponseSchema, pick: readCyclePlan },
  );
}

export function copyCycleWeekOne(
  cycleId: string,
): Promise<PlannerOutcome<CyclePlan>> {
  return requestAndRead(
    trainingManageCycleActionApiPath(cycleId, "copy-week-one"),
    jsonInit("POST"),
    { schema: cyclePlanResponseSchema, pick: readCyclePlan },
  );
}

export function clearCycleWeek(
  cycleId: string,
  weekNo: number,
): Promise<PlannerOutcome<CyclePlan>> {
  return requestAndRead(
    trainingManageCycleWeekClearApiPath(cycleId, weekNo),
    jsonInit("POST"),
    { schema: cyclePlanResponseSchema, pick: readCyclePlan },
  );
}
