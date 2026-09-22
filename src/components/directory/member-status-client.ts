import { z } from "zod";
import {
  type ApiRequestFailure,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import {
  ACCOUNT_STATUSES,
  type AccountStatus,
} from "@/lib/auth/account-status";
import { MEMBER_STATUS_API_PATH } from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import type { RequestableMemberStatus } from "@/lib/members/member-status-change";

/**
 * Lo que la ficha le pide a la API v1 para dar de baja o reactivar a un
 * miembro (#244, RF-6 del PRD de E5), y cómo reduce la respuesta a algo que
 * pintar. Todo pasa por el endpoint: la aplicación nativa de Release 2 usará
 * exactamente el mismo camino (CON-002).
 */

const memberStatusSchema = z.object({
  data: z.object({ status: z.enum(ACCOUNT_STATUSES) }),
});

/** Las reglas que el endpoint nombra en `reason` cuando dice que no. */
const LAST_ADMIN_REASON = "last_admin";
const SELF_DEACTIVATION_REASON = "self_deactivation";
/** El estado sí cambió, pero su rastro no llegó a la bitácora: no es un
 * "vuelve a intentarlo", porque el segundo intento no encontraría nada que
 * cambiar. */
const AUDIT_NOT_RECORDED_REASON = "audit_not_recorded";

export type MemberStatusFailure = ApiRequestFailure;

export type MemberStatusOutcome =
  | { readonly kind: "changed"; readonly status: AccountStatus }
  | MemberStatusFailure;

export async function submitMemberStatus(
  userId: string,
  status: RequestableMemberStatus,
): Promise<MemberStatusOutcome> {
  const outcome = await requestApi(
    MEMBER_STATUS_API_PATH.replace("[id]", userId),
    {
      method: "PATCH",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify({ status }),
    },
  );
  if (outcome.kind === "failed") {
    return outcome;
  }
  const read = readApiPayload(outcome, memberStatusSchema);
  return read.kind === "failed"
    ? read
    : { kind: "changed", status: read.value.data.status };
}

/** Por qué el servidor no cambió el estado, en el idioma de la pantalla. */
export function describeMemberStatusFailure(
  translate: Translator,
  { failure, reason }: MemberStatusFailure,
): string {
  if (reason === LAST_ADMIN_REASON) {
    return translate("memberStatus.error.lastAdmin");
  }
  if (reason === SELF_DEACTIVATION_REASON) {
    return translate("memberStatus.error.selfDeactivation");
  }
  if (reason === AUDIT_NOT_RECORDED_REASON) {
    return translate("memberStatus.error.notAudited");
  }
  switch (failure) {
    case "network":
      return translate("auth.error.network");
    case "not_found":
      return translate("memberRecord.error.memberNotFound");
    case "unauthenticated":
      return translate("memberRecord.error.signInRequired");
    case "forbidden":
      return translate("memberRecord.error.forbidden");
    default:
      return translate("memberStatus.error.unexpected");
  }
}
