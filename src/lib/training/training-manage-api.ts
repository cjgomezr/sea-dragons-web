import type { NextRequest, NextResponse } from "next/server";
import { type ZodType, z } from "zod";
import { createApiRoute } from "@/lib/api/handler";
import { ApiError, ApiErrorWithDetails } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  CycleValidationError,
  CYCLE_EVENT_NAME_MAX_LENGTH,
  CYCLE_NAME_MAX_LENGTH,
  DOSE_REPS_MAX_LENGTH,
  DOSE_TEXT_MAX_LENGTH,
  WEEK_NOTE_MAX_LENGTH,
} from "./club-cycle-input";
import {
  type ClubCyclesGateways,
  type CycleChanges,
  type CycleDayChange,
  type CycleInput,
  type CycleWeekRecord,
  CycleDaysWouldBeRemovedError,
  CycleNotFoundError,
} from "./club-cycles";
import {
  type ClubExercisesGateways,
  ExerciseInUseError,
  ExerciseNameTakenError,
  ExerciseNotFoundError,
  ExerciseValidationError,
  LibraryExerciseReadOnlyError,
} from "./club-exercises";
import {
  type ClubMarksGateways,
  MARK_NAME_MAX_LENGTH,
  MarkHasValuesError,
  MarkInUseError,
  MarkNameTakenError,
  MarkNotFoundError,
  MarkValidationError,
} from "./club-marks";
import { createSupabaseClubCyclesGateways } from "./supabase-club-cycles-gateways";
import { createSupabaseClubExercisesGateways } from "./supabase-club-exercises-gateways";
import { createSupabaseClubMarksGateways } from "./supabase-club-marks-gateways";
import { TrainingPlannerForbiddenError } from "./training-planner";

/**
 * Lo que comparten los endpoints de Planificar (#903): cómo se cablean, cómo
 * se lee un id de la ruta y cómo responde cada error del dominio.
 */

export const MARK_NAME_TAKEN_REASON = "mark_name_taken";
export const MARK_IN_USE_REASON = "mark_in_use";
export const MARK_HAS_VALUES_REASON = "mark_has_values";
export const EXERCISE_NAME_TAKEN_REASON = "exercise_name_taken";
export const EXERCISE_IN_USE_REASON = "exercise_in_use";
export const LIBRARY_EXERCISE_REASON = "library_exercise";
export const CYCLE_DAYS_WOULD_BE_REMOVED_REASON = "cycle_days_would_be_removed";

/** Un tope holgado sólo para no arrastrar un cuerpo de megas hasta el
 * dominio, que cuenta en caracteres y dice qué falló. */
const MARK_NAME_BODY_MAX_LENGTH = MARK_NAME_MAX_LENGTH * 4;

export const markNameBodySchema = z
  .object({ name: z.string().max(MARK_NAME_BODY_MAX_LENGTH) })
  .strict();

/** Un tope holgado sobre cada texto de un ciclo, como el del nombre de una
 * marca: el dominio cuenta en caracteres y dice cuál falló. */
const BODY_TEXT_SLACK = 4;

function bodyText(maxLength: number) {
  return z.string().max(maxLength * BODY_TEXT_SLACK);
}

const cycleScheduleSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("event"),
      eventName: bodyText(CYCLE_EVENT_NAME_MAX_LENGTH),
      eventDate: z.iso.date(),
    })
    .strict(),
  z.object({ kind: z.literal("start"), startDate: z.iso.date() }).strict(),
]);

const cycleWeeksSchema = z.number().int();

export const cycleBodySchema: z.ZodType<CycleInput> = z
  .object({
    name: bodyText(CYCLE_NAME_MAX_LENGTH),
    weeks: cycleWeeksSchema,
    schedule: cycleScheduleSchema,
  })
  .strict();

export type CycleChangesBody = CycleChanges & {
  readonly confirmRemoval?: boolean;
};

export const cycleChangesBodySchema: z.ZodType<CycleChangesBody> = z
  .object({
    name: bodyText(CYCLE_NAME_MAX_LENGTH).optional(),
    weeks: cycleWeeksSchema.optional(),
    schedule: cycleScheduleSchema.optional(),
    confirmRemoval: z.boolean().optional(),
  })
  .strict();

const doseIntensitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("pct"), pct: z.number() }).strict(),
  z
    .object({ kind: z.literal("text"), text: bodyText(DOSE_TEXT_MAX_LENGTH) })
    .strict(),
]);

export const cycleWeekBodySchema: z.ZodType<CycleWeekRecord> = z
  .object({
    weekNo: z.number().int(),
    note: bodyText(WEEK_NOTE_MAX_LENGTH).nullable(),
    dose: z
      .object({
        sets: z.number().int().nullable(),
        reps: bodyText(DOSE_REPS_MAX_LENGTH).nullable(),
        intensity: doseIntensitySchema,
      })
      .strict()
      .nullable(),
  })
  .strict();

export const cycleDayBodySchema: z.ZodType<CycleDayChange> = z
  .object({
    weekNo: z.number().int(),
    weekday: z.number().int(),
    slot: z.union([z.literal(1), z.literal(2)]),
    routineId: z.uuid().nullable(),
  })
  .strict();

export function requireClubCyclesGateways(): ClubCyclesGateways {
  const wiring = createSupabaseClubCyclesGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

export function requireClubMarksGateways(): ClubMarksGateways {
  const wiring = createSupabaseClubMarksGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

export function requireClubExercisesGateways(): ClubExercisesGateways {
  const wiring = createSupabaseClubExercisesGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

/** Un id que no es un uuid no nombra nada: 404, sin mandarle a Postgres un
 * valor que rechazaría. */
export function readRouteId(value: string, notFound: Error): string {
  if (!z.uuid().safeParse(value).success) {
    throw new ApiError("not_found", notFound.message);
  }
  return value;
}

function asMarkApiError(error: unknown): void {
  if (error instanceof MarkValidationError) {
    throw new ApiError("validation_error", error.message, error.code);
  }
  if (error instanceof MarkNotFoundError) {
    throw new ApiError("not_found", error.message);
  }
  if (error instanceof MarkNameTakenError) {
    throw new ApiError("conflict", error.message, MARK_NAME_TAKEN_REASON);
  }
  if (error instanceof MarkInUseError) {
    throw new ApiError("conflict", error.message, MARK_IN_USE_REASON);
  }
  if (error instanceof MarkHasValuesError) {
    throw new ApiErrorWithDetails("conflict", error.message, {
      reason: MARK_HAS_VALUES_REASON,
      details: { membersRecorded: error.membersRecorded },
    });
  }
}

function asExerciseApiError(error: unknown): void {
  if (error instanceof ExerciseValidationError) {
    throw new ApiError("validation_error", error.message, error.code);
  }
  if (error instanceof ExerciseNotFoundError) {
    throw new ApiError("not_found", error.message);
  }
  if (error instanceof LibraryExerciseReadOnlyError) {
    throw new ApiError("forbidden", error.message, LIBRARY_EXERCISE_REASON);
  }
  if (error instanceof ExerciseNameTakenError) {
    throw new ApiError("conflict", error.message, EXERCISE_NAME_TAKEN_REASON);
  }
  if (error instanceof ExerciseInUseError) {
    throw new ApiError("conflict", error.message, EXERCISE_IN_USE_REASON);
  }
}

function asCycleApiError(error: unknown): void {
  if (error instanceof CycleValidationError) {
    throw new ApiError("validation_error", error.message, error.code);
  }
  if (error instanceof CycleNotFoundError) {
    throw new ApiError("not_found", error.message);
  }
  if (error instanceof CycleDaysWouldBeRemovedError) {
    throw new ApiErrorWithDetails("conflict", error.message, {
      reason: CYCLE_DAYS_WOULD_BE_REMOVED_REASON,
      details: { daysRemoved: error.daysRemoved },
    });
  }
}

export function asTrainingManageApiError(error: unknown): never {
  if (error instanceof TrainingPlannerForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  asMarkApiError(error);
  asCycleApiError(error);
  asExerciseApiError(error);
  return asAccountApiError(error);
}

export type CycleRouteContext = {
  readonly params: Promise<{ readonly cycleId: string }>;
};

export type CycleRouteRequest<Body> = {
  readonly callerId: string;
  readonly cycleId: string;
  readonly body: Body;
};

/** Un handler de `/cycles/{cycleId}/...` (#904): quién llama, qué ciclo y el
 * cuerpo ya validado, y cada error del dominio con su código. Todas las
 * rutas de un ciclo lo comparten y sólo cambian en qué hacen. */
export function createCycleRoute<T, Body = undefined>(config: {
  readonly schema?: ZodType<Body>;
  readonly run: (
    gateways: ClubCyclesGateways,
    request: CycleRouteRequest<Body>,
  ) => Promise<T>;
}): (
  request: NextRequest,
  context: CycleRouteContext,
) => Promise<NextResponse> {
  return (request, context) =>
    createApiRoute<T, Body>({
      schema: config.schema,
      handler: async ({ request: apiRequest, body, decorateResponse }) => {
        const callerId = await identifyAccountCaller({
          request: apiRequest,
          decorateResponse,
        });
        const cycleId = readRouteId(
          (await context.params).cycleId,
          new CycleNotFoundError(),
        );
        try {
          return {
            data: await config.run(requireClubCyclesGateways(), {
              callerId,
              cycleId,
              body,
            }),
          };
        } catch (error) {
          return asTrainingManageApiError(error);
        }
      },
    })(request);
}
