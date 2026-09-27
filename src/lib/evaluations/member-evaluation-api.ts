import { z } from "zod";
import { ApiError } from "@/lib/api/response";
import { asAccountApiError } from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  EVALUATION_CHANGED_REASON,
  EVALUATION_EXISTS_REASON,
  EVALUATION_NOT_FOUND_REASON,
  EvaluatedMemberInactiveError,
  EvaluatedMemberNotFoundError,
  EvaluationAlreadyExistsError,
  EvaluationChangedError,
  EvaluationForbiddenError,
  EvaluationNotFoundError,
  EvaluationValidationError,
  MEMBER_INACTIVE_REASON,
  MEMBER_NOT_FOUND_REASON,
  type MemberEvaluationGateways,
  NO_ACTIVE_CATEGORIES_REASON,
  NoActiveCategoriesError,
} from "./member-evaluation";
import { createSupabaseMemberEvaluationGateways } from "./supabase-member-evaluation-gateways";

/**
 * Lo que comparten los endpoints de la evaluación de un miembro (#319, #320):
 * cómo se cablean, cómo se lee el `[id]` y cómo responde cada error del
 * dominio.
 */

export type MemberEvaluationRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export function requireMemberEvaluationGateways(): MemberEvaluationGateways {
  const wiring = createSupabaseMemberEvaluationGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

/** Un id que no es un uuid no puede nombrar a ningún miembro: se responde
 * como uno que no existe, sin mandarle a Postgres un valor que rechazaría. */
export async function readMemberId(
  context: MemberEvaluationRouteContext,
): Promise<string> {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    throw new ApiError(
      "not_found",
      new EvaluatedMemberNotFoundError().message,
      MEMBER_NOT_FOUND_REASON,
    );
  }
  return id;
}

/** El código del primer problema va como `reason`, que la pantalla traduce. */
export function asEvaluationApiError(error: unknown): never {
  if (error instanceof EvaluationValidationError) {
    throw new ApiError(
      "validation_error",
      error.message,
      error.issues[0]?.code,
    );
  }
  if (error instanceof EvaluationForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  if (error instanceof EvaluatedMemberNotFoundError) {
    throw new ApiError("not_found", error.message, MEMBER_NOT_FOUND_REASON);
  }
  if (error instanceof EvaluationNotFoundError) {
    throw new ApiError("not_found", error.message, EVALUATION_NOT_FOUND_REASON);
  }
  if (error instanceof EvaluatedMemberInactiveError) {
    throw new ApiError("business_rule", error.message, MEMBER_INACTIVE_REASON);
  }
  if (error instanceof NoActiveCategoriesError) {
    throw new ApiError(
      "business_rule",
      error.message,
      NO_ACTIVE_CATEGORIES_REASON,
    );
  }
  if (error instanceof EvaluationAlreadyExistsError) {
    throw new ApiError("conflict", error.message, EVALUATION_EXISTS_REASON);
  }
  if (error instanceof EvaluationChangedError) {
    throw new ApiError("conflict", error.message, EVALUATION_CHANGED_REASON);
  }
  return asAccountApiError(error);
}
