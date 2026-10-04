import { z } from "zod";
import {
  type ApiRequestFailure,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { MEMBERSHIP_WAIVER_API_PATH } from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import type {
  MembershipWaiverChange,
  WaiverSubmission,
} from "@/lib/membership/membership-waiver";
import { MEMBERSHIP_STATUSES } from "@/lib/membership/membership";

/**
 * Lo que la ficha le pide a la API v1 para eximir de cuota a un miembro y
 * retirarle la exención (#457, RF-4 del PRD de E12), y cómo reduce la
 * respuesta a algo que pintar. Todo pasa por el endpoint: la aplicación
 * nativa de Release 2 usará el mismo camino (CON-002).
 */

export const membershipWaiverSchema = z
  .object({
    reason: z.string(),
    until: z.iso.datetime({ offset: true }).nullable(),
  })
  .nullable();

const waiverChangeSchema = z.object({
  data: z.object({
    userId: z.uuid(),
    membershipStatus: z.enum(MEMBERSHIP_STATUSES),
    waiver: membershipWaiverSchema,
  }),
});

/** Los motivos que el endpoint nombra en `reason` cuando dice que no. */
const FAILURE_MESSAGE_KEYS = {
  reason_required: "membershipWaiver.error.reasonRequired",
  reason_too_long: "membershipWaiver.error.reasonTooLong",
  until_not_a_date: "membershipWaiver.error.untilNotADate",
  until_not_after_today: "membershipWaiver.error.untilNotAfterToday",
  not_waived: "membershipWaiver.error.notWaived",
  // La exención sí cambió, pero su rastro no llegó a la bitácora: no es un
  // "vuelve a intentarlo".
  audit_not_recorded: "membershipWaiver.error.notAudited",
} as const;

export type MembershipWaiverOutcome =
  | { readonly kind: "changed"; readonly change: MembershipWaiverChange }
  | ApiRequestFailure;

async function requestWaiverChange(
  userId: string,
  init: RequestInit,
): Promise<MembershipWaiverOutcome> {
  const outcome = await requestApi(
    MEMBERSHIP_WAIVER_API_PATH.replace("[id]", userId),
    init,
  );
  if (outcome.kind === "failed") {
    return outcome;
  }
  const read = readApiPayload(outcome, waiverChangeSchema);
  return read.kind === "failed"
    ? read
    : { kind: "changed", change: read.value.data };
}

export function submitMembershipWaiver(
  userId: string,
  submission: WaiverSubmission,
): Promise<MembershipWaiverOutcome> {
  return requestWaiverChange(userId, {
    method: "POST",
    headers: JSON_REQUEST_HEADERS,
    body: JSON.stringify(submission),
  });
}

export function removeMembershipWaiver(
  userId: string,
): Promise<MembershipWaiverOutcome> {
  return requestWaiverChange(userId, { method: "DELETE" });
}

function isKnownReason(
  reason: string | null,
): reason is keyof typeof FAILURE_MESSAGE_KEYS {
  return reason !== null && Object.hasOwn(FAILURE_MESSAGE_KEYS, reason);
}

/** Por qué el servidor no cambió la exención, en el idioma de la pantalla. */
export function describeMembershipWaiverFailure(
  translate: Translator,
  { failure, reason }: ApiRequestFailure,
): string {
  if (isKnownReason(reason)) {
    return translate(FAILURE_MESSAGE_KEYS[reason]);
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
      return translate("membershipWaiver.error.unexpected");
  }
}
