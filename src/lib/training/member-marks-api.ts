import { z } from "zod";
import {
  ApiError,
  ApiErrorWithDetails,
  MEMBERSHIP_NOT_CURRENT_REASON,
} from "@/lib/api/response";
import { asAccountApiError } from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  MemberMarkNotFoundError,
  type MemberMarks,
  type MemberMarksGateways,
  TrainingAccessBlockedError,
} from "./member-marks";
import { createSupabaseMemberMarksGateways } from "./supabase-member-marks-gateways";

/**
 * Lo que comparten los dos endpoints de Mis marcas (#899): la lista y el
 * guardado o borrado de una marca.
 */

export type MemberMarksResponse = MemberMarks;

const BLOCKED_MESSAGE =
  "Tu membresía no está al día: renuévala en Pagos para guardar tus marcas.";

export function requireMemberMarksGateways(): MemberMarksGateways {
  const wiring = createSupabaseMemberMarksGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

/** Un id que no es un uuid no es ninguna marca: 404, no un error de la base. */
export function readMarkId(value: string): string {
  if (!z.uuid().safeParse(value).success) {
    throw new ApiError("not_found", new MemberMarkNotFoundError().message);
  }
  return value;
}

export function asMemberMarksApiError(error: unknown): never {
  if (error instanceof TrainingAccessBlockedError) {
    throw new ApiErrorWithDetails("forbidden", BLOCKED_MESSAGE, {
      reason: MEMBERSHIP_NOT_CURRENT_REASON,
      details: { block: error.block },
    });
  }
  if (error instanceof MemberMarkNotFoundError) {
    throw new ApiError("not_found", error.message);
  }
  return asAccountApiError(error);
}
