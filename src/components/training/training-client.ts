import { z } from "zod";
import { MEMBERSHIP_NOT_CURRENT_REASON } from "@/lib/api/error-codes";
import {
  type ApiRequestOutcome,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import {
  TRAINING_MY_MARKS_API_PATH,
  TRAINING_PLAN_API_PATH,
  trainingMyMarkApiPath,
} from "@/lib/auth/routes";
import type { MembershipBlock } from "@/lib/membership/membership";
import type { MemberMarks } from "@/lib/training/member-marks";
import type { TrainingCycle, TrainingPlan } from "@/lib/training/training-plan";

/**
 * Lo que la pantalla de Entrenamiento (#900) le pide a la API v1 (#898) y
 * cómo reduce la respuesta a algo que pintar. Nada habla con la base: la
 * aplicación nativa de Release 2 va a usar este mismo camino (CON-002).
 */

const markRefSchema = z.object({ id: z.string(), name: z.string() });

const loadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("pct"), mark: markRefSchema, pct: z.number() }),
  z.object({ kind: z.literal("week"), mark: markRefSchema }),
  z.object({ kind: z.literal("text"), text: z.string() }),
]);

const doseSchema = z.object({
  sets: z.number().nullable(),
  reps: z.string().nullable(),
  intensity: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }),
    z.object({ kind: z.literal("pct"), pct: z.number() }),
    z.object({ kind: z.literal("text"), text: z.string() }),
  ]),
});

const routineItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("section"), id: z.string(), title: z.string() }),
  z.object({
    kind: z.literal("exercise"),
    id: z.string(),
    exercise: z.object({
      id: z.string(),
      name: z.string(),
      tips: z.array(z.string()),
      photoUrls: z.array(z.string()),
      youtubeUrl: z.string(),
    }),
    sets: z.number().nullable(),
    reps: z.string().nullable(),
    rest: z.string().nullable(),
    note: z.string().nullable(),
    load: loadSchema,
  }),
]);

const routineSchema = z.object({
  id: z.string(),
  name: z.string(),
  colorIndex: z.number().int(),
  items: z.array(routineItemSchema),
});

const cycleSchema = z.object({
  id: z.string(),
  name: z.string(),
  event: z
    .object({ name: z.string(), date: z.iso.date().nullable() })
    .nullable(),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  weeks: z.number().int().positive(),
});

const activePlanSchema = z.object({
  cycle: cycleSchema,
  current: z.object({
    week: z.number().int().positive(),
    phase: z.enum(["not_started", "running", "finished"]),
    today: z.iso.date(),
  }),
  week: z.object({
    number: z.number().int().positive(),
    note: z.string().nullable(),
    dose: doseSchema.nullable(),
    days: z.array(
      z.object({
        weekday: z.number().int(),
        date: z.iso.date(),
        routines: z.array(routineSchema),
      }),
    ),
  }),
});

const planResponseSchema: z.ZodType<{ readonly data: TrainingPlan }> = z.object(
  {
    data: z.union([z.object({ cycle: z.null() }), activePlanSchema]),
  },
);

/** El 403 de quien no está al día (#898): el motivo y la cabecera del ciclo,
 * o nula si el club no tiene ciclo activo. */
const blockedResponseSchema = z.object({
  error: z.object({
    reason: z.literal(MEMBERSHIP_NOT_CURRENT_REASON),
    block: z.enum(["pending", "past_due", "cancelled"]),
    cycle: cycleSchema.nullable(),
  }),
});

/** La puerta cerrada de quien no está al día, con lo que la tarjeta dice. */
export type TrainingPlanBlock = {
  readonly block: MembershipBlock;
  readonly cycle: TrainingCycle | null;
};

/** El plan, la puerta cerrada de quien no está al día, o un fallo. */
export type TrainingPlanOutcome =
  | { readonly kind: "loaded"; readonly plan: TrainingPlan }
  | ({ readonly kind: "blocked" } & TrainingPlanBlock)
  | { readonly kind: "failed" };

function toBlockedOutcome(payload: unknown): TrainingPlanOutcome {
  const parsed = blockedResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return { kind: "failed" };
  }
  const { block, cycle } = parsed.data.error;
  return { kind: "blocked", block, cycle };
}

/** La semana `week` del ciclo activo, o la de hoy si es nula.
 *
 * Va por su cuenta y no por `requestApi`: del 403, además del motivo, hacen
 * falta el de la membresía y la cabecera del ciclo (#902). */
export async function loadTrainingPlan(
  week: number | null,
): Promise<TrainingPlanOutcome> {
  const path =
    week === null
      ? TRAINING_PLAN_API_PATH
      : `${TRAINING_PLAN_API_PATH}?week=${week}`;
  let response: Response;
  try {
    response = await fetch(path);
  } catch {
    return { kind: "failed" };
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return toBlockedOutcome(payload);
  }
  const parsed = planResponseSchema.safeParse(payload);
  return parsed.success
    ? { kind: "loaded", plan: parsed.data.data }
    : { kind: "failed" };
}

const memberMarksResponseSchema: z.ZodType<{
  readonly data: MemberMarks;
}> = z.object({
  data: z.object({
    marks: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        unit: z.literal("kg"),
        value: z.number().nullable(),
      }),
    ),
  }),
});

/** Las marcas del socio, la puerta cerrada, o un fallo. */
export type MemberMarksOutcome =
  | { readonly kind: "loaded"; readonly marks: MemberMarks }
  | { readonly kind: "blocked" }
  | { readonly kind: "failed" };

function toMemberMarksOutcome(outcome: ApiRequestOutcome): MemberMarksOutcome {
  const read = readApiPayload(outcome, memberMarksResponseSchema);
  if (read.kind === "ok") {
    return { kind: "loaded", marks: read.value.data };
  }
  return read.failure === "forbidden" &&
    read.reason === MEMBERSHIP_NOT_CURRENT_REASON
    ? { kind: "blocked" }
    : { kind: "failed" };
}

export async function loadMemberMarks(): Promise<MemberMarksOutcome> {
  return toMemberMarksOutcome(await requestApi(TRAINING_MY_MARKS_API_PATH));
}

/** Guarda el valor de una marca, o la deja sin valor si es nulo. Responde la
 * lista entera, como el GET. */
export async function storeMemberMark(
  markId: string,
  value: number | null,
): Promise<MemberMarksOutcome> {
  const path = trainingMyMarkApiPath(markId);
  const init: RequestInit =
    value === null
      ? { method: "DELETE" }
      : {
          method: "PUT",
          headers: JSON_REQUEST_HEADERS,
          body: JSON.stringify({ value }),
        };
  return toMemberMarksOutcome(await requestApi(path, init));
}
