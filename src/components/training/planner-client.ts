import { z } from "zod";
import {
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import {
  TRAINING_MANAGE_CYCLES_API_PATH,
  trainingManageCycleActionApiPath,
  trainingManageCycleApiPath,
} from "@/lib/auth/routes";
import type {
  CycleChanges,
  CycleInput,
  ManagedCycle,
} from "@/lib/training/club-cycles";

/**
 * Lo que Planificar → Ciclo (#906) le pide a la API v1 de los ciclos (#904).
 * Nada habla con la base: la aplicación nativa usará estos mismos caminos
 * (CON-002).
 */

/** El 409 de bajar las semanas cuando las que sobran tienen días (#904). */
const DAYS_WOULD_BE_REMOVED_REASON = "cycle_days_would_be_removed";

const managedCycleSchema: z.ZodType<ManagedCycle> = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["draft", "active", "archived"]),
  weeks: z.number().int().positive(),
  startDate: z.iso.date(),
  event: z.object({ name: z.string(), date: z.iso.date() }).nullable(),
  ownRoutines: z.number().int().nonnegative(),
});

const cyclesResponseSchema = z.object({
  data: z.object({ cycles: z.array(managedCycleSchema) }),
});

/** Un ciclo con sus semanas y su cuadrícula: aquí basta el ciclo. */
const cycleDetailResponseSchema = z.object({
  data: z.object({ cycle: managedCycleSchema }),
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

export type DuplicateOutcome = {
  readonly cycles: CycleList;
  readonly duplicatedCycleId: string;
  readonly routinesCopied: number;
};

/** Un cambio puede pedir confirmar antes de quitar días con rutina. */
export type CycleUpdateOutcome =
  | PlannerOutcome<ManagedCycle>
  | { readonly kind: "confirmRemoval"; readonly daysRemoved: number };

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

/** Va por su cuenta y no por `requestApi`: del 409 hace falta cuántos días
 * se perderían, que `requestApi` no guarda. */
export async function updateCycle(
  cycleId: string,
  request: {
    readonly changes: CycleChanges;
    readonly confirmRemoval: boolean;
  },
): Promise<CycleUpdateOutcome> {
  const body = request.confirmRemoval
    ? { ...request.changes, confirmRemoval: true }
    : request.changes;
  let response: Response;
  try {
    response = await fetch(
      trainingManageCycleApiPath(cycleId),
      jsonInit("PATCH", body),
    );
  } catch {
    return { kind: "failed", reason: null };
  }
  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = cycleDetailResponseSchema.safeParse(payload);
    return parsed.success
      ? { kind: "ok", value: parsed.data.data.cycle }
      : { kind: "failed", reason: null };
  }
  const removal = daysWouldBeRemovedSchema.safeParse(payload);
  if (removal.success) {
    return {
      kind: "confirmRemoval",
      daysRemoved: removal.data.error.daysRemoved,
    };
  }
  const reason = errorReasonSchema.safeParse(payload);
  return {
    kind: "failed",
    reason: reason.success ? reason.data.error.reason : null,
  };
}

export function activateCycle(
  cycleId: string,
): Promise<PlannerOutcome<CycleList>> {
  return requestAndRead(
    trainingManageCycleActionApiPath(cycleId, "activate"),
    jsonInit("POST"),
    { schema: cyclesResponseSchema, pick: (response) => response.data.cycles },
  );
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

export function duplicateCycle(
  cycleId: string,
): Promise<PlannerOutcome<DuplicateOutcome>> {
  return requestAndRead(
    trainingManageCycleActionApiPath(cycleId, "duplicate"),
    jsonInit("POST"),
    { schema: duplicatedResponseSchema, pick: (response) => response.data },
  );
}
