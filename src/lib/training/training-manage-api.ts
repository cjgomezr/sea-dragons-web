import { z } from "zod";
import { ApiError, ApiErrorWithDetails } from "@/lib/api/response";
import { asAccountApiError } from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
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

/** Un tope holgado sólo para no arrastrar un cuerpo de megas hasta el
 * dominio, que cuenta en caracteres y dice qué falló. */
const MARK_NAME_BODY_MAX_LENGTH = MARK_NAME_MAX_LENGTH * 4;

export const markNameBodySchema = z
  .object({ name: z.string().max(MARK_NAME_BODY_MAX_LENGTH) })
  .strict();

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

export function asTrainingManageApiError(error: unknown): never {
  if (error instanceof TrainingPlannerForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  asMarkApiError(error);
  asExerciseApiError(error);
  return asAccountApiError(error);
}
