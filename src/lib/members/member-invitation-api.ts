import { ApiError } from "@/lib/api/response";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { GroupNotFoundError } from "@/lib/groups/groups";
import { asGroupsApiError } from "@/lib/groups/groups-api";
import {
  EMAIL_TAKEN_REASON,
  INVITATION_NOT_PENDING_REASON,
  INVITATION_NOT_SENT_REASON,
  InvitationNotPendingError,
  InvitationNotSentError,
  InvitationRateLimitedError,
  MemberEmailTakenError,
  MemberInvitationForbiddenError,
  type MemberInvitationGateways,
  NewMemberValidationError,
} from "./member-invitation";
import {
  GROUP_NOT_FOUND_REASON,
  MEMBER_NOT_FOUND_REASON,
  MemberRecordNotFoundError,
} from "./member-record";
import { createSupabaseMemberInvitationGateways } from "./supabase-member-invitation-gateways";

/**
 * Lo que comparten el alta (`POST /api/v1/members`) y el reenvío de la
 * invitación (#243): de dónde salen los adaptadores y cómo se responde cada
 * error del dominio.
 */

export function requireMemberInvitationGateways(): MemberInvitationGateways {
  const wiring = createSupabaseMemberInvitationGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

/** El primer campo que no vale va como `reason`, que la pantalla traduce. */
export function asMemberInvitationApiError(error: unknown): never {
  if (error instanceof NewMemberValidationError) {
    throw new ApiError(
      "validation_error",
      error.message,
      error.issues[0]?.code,
    );
  }
  if (error instanceof MemberInvitationForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  if (error instanceof MemberEmailTakenError) {
    throw new ApiError("conflict", error.message, EMAIL_TAKEN_REASON);
  }
  if (error instanceof InvitationNotPendingError) {
    throw new ApiError(
      "conflict",
      error.message,
      INVITATION_NOT_PENDING_REASON,
    );
  }
  if (error instanceof InvitationRateLimitedError) {
    throw new ApiError("rate_limited", error.message);
  }
  if (error instanceof InvitationNotSentError) {
    console.error("[api/v1/members] la invitación no salió", error.reason);
    throw new ApiError(
      "service_unavailable",
      error.message,
      INVITATION_NOT_SENT_REASON,
    );
  }
  if (error instanceof MemberRecordNotFoundError) {
    throw new ApiError("not_found", error.message, MEMBER_NOT_FOUND_REASON);
  }
  if (error instanceof GroupNotFoundError) {
    throw new ApiError("not_found", error.message, GROUP_NOT_FOUND_REASON);
  }
  return asGroupsApiError(error);
}
