import { z } from "zod";
import { ApiError } from "@/lib/api/response";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { InactiveMemberError } from "@/lib/groups/group-members";
import { GroupNotFoundError } from "@/lib/groups/groups";
import { asGroupsApiError } from "@/lib/groups/groups-api";
import {
  AUF_CHANGED_REASON,
  GROUP_NOT_FOUND_REASON,
  MEMBER_INACTIVE_REASON,
  MEMBER_NOT_FOUND_REASON,
  MEMBER_STATUS_CHANGED_REASON,
  MemberAufChangedError,
  MemberRecordConflictError,
  MemberRecordForbiddenError,
  type MemberRecordGateways,
  MemberRecordNotFoundError,
  MemberRecordValidationError,
} from "./member-record";
import { createSupabaseMemberRecordGateways } from "./supabase-member-record-gateways";

/**
 * Lo que comparten la ficha reservada al Admin (#242) y la verificación de
 * su AUF (#274): de dónde salen los adaptadores, cómo se lee el socio del
 * camino y cómo se responde cada error del dominio.
 */

export type MemberRecordRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export function requireMemberRecordGateways(): MemberRecordGateways {
  const wiring = createSupabaseMemberRecordGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

/** Un id que no es un uuid no puede nombrar a ningún socio: se responde como
 * uno que no existe, sin mandarle a Postgres un valor que rechazaría. */
export async function readMemberId(
  context: MemberRecordRouteContext,
): Promise<string> {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    throw new ApiError(
      "not_found",
      new MemberRecordNotFoundError().message,
      MEMBER_NOT_FOUND_REASON,
    );
  }
  return id;
}

/** El primer campo que no vale va como `reason`, que la pantalla traduce. */
export function asMemberRecordApiError(error: unknown): never {
  if (error instanceof MemberRecordValidationError) {
    throw new ApiError(
      "validation_error",
      error.message,
      error.issues[0]?.code,
    );
  }
  if (error instanceof MemberRecordForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  if (error instanceof MemberRecordNotFoundError) {
    throw new ApiError("not_found", error.message, MEMBER_NOT_FOUND_REASON);
  }
  if (error instanceof GroupNotFoundError) {
    throw new ApiError("not_found", error.message, GROUP_NOT_FOUND_REASON);
  }
  if (error instanceof MemberRecordConflictError) {
    throw new ApiError("conflict", error.message, MEMBER_STATUS_CHANGED_REASON);
  }
  if (error instanceof MemberAufChangedError) {
    throw new ApiError("conflict", error.message, AUF_CHANGED_REASON);
  }
  if (error instanceof InactiveMemberError) {
    throw new ApiError("business_rule", error.message, MEMBER_INACTIVE_REASON);
  }
  return asGroupsApiError(error);
}
