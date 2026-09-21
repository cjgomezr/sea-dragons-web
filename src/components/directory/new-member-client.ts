import { z } from "zod";
import {
  type ApiRequestFailure,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import {
  MEMBERS_API_PATH,
  MEMBER_INVITATION_API_PATH,
} from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import {
  EMAIL_TAKEN_REASON,
  INVITATION_NOT_SENT_REASON,
  NEW_MEMBER_ISSUE_CODES,
  type NewMemberIssueCode,
  type NewMemberSubmission,
} from "@/lib/members/member-invitation";
import {
  AUF_NUMBER_MAX_LENGTH,
  GROUP_NOT_FOUND_REASON,
} from "@/lib/members/member-record";

/**
 * Lo que la pantalla de alta (#243) le pide a la API v1 y cómo reduce cada
 * respuesta a algo que pintar. Nada habla con la base: la aplicación nativa de
 * Release 2 usará estos mismos endpoints (CON-002). De un error se guarda el
 * código y no la frase, para que el aviso cambie de idioma con el interruptor
 * (E17).
 */

const createdSchema = z.object({
  data: z.object({
    member: z.object({
      userId: z.uuid(),
      fullName: z.string(),
      email: z.string(),
    }),
    invitation: z.enum(["sent", "not_sent"]),
  }),
});

const resentSchema = z.object({
  data: z.object({ invitation: z.literal("sent") }),
});

export type CreatedMemberView = z.infer<typeof createdSchema>["data"];

export type NewMemberFailure = ApiRequestFailure;

export type MemberCreation =
  | { readonly kind: "created"; readonly created: CreatedMemberView }
  | NewMemberFailure;

export type InvitationResend = { readonly kind: "sent" } | NewMemberFailure;

export async function createMember(
  submission: NewMemberSubmission,
): Promise<MemberCreation> {
  const read = readApiPayload(
    await requestApi(MEMBERS_API_PATH, {
      method: "POST",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify(submission),
    }),
    createdSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "created", created: read.value.data };
}

export async function resendMemberInvitation(
  userId: string,
): Promise<InvitationResend> {
  const read = readApiPayload(
    await requestApi(MEMBER_INVITATION_API_PATH.replace("[id]", userId), {
      method: "POST",
    }),
    resentSchema,
  );
  return read.kind === "failed" ? read : { kind: "sent" };
}

/** El campo del que habla un 400, si el `reason` es uno del alta. */
export function readNewMemberIssueCode(
  failure: NewMemberFailure,
): NewMemberIssueCode | null {
  if (failure.failure !== "validation_error") {
    return null;
  }
  return NEW_MEMBER_ISSUE_CODES.find((code) => code === failure.reason) ?? null;
}

export function isEmailTaken(failure: NewMemberFailure): boolean {
  return (
    failure.failure === "conflict" && failure.reason === EMAIL_TAKEN_REASON
  );
}

export function describeNewMemberIssue(
  translate: Translator,
  code: NewMemberIssueCode,
): string {
  switch (code) {
    case "full_name_missing":
      return translate("newMember.issue.fullNameMissing");
    case "email_malformed":
      return translate("newMember.issue.emailMalformed");
    case "country_unknown":
      return translate("newMember.issue.countryUnknown");
    case "position_unknown":
      return translate("newMember.issue.positionUnknown");
    case "experience_level_unknown":
      return translate("newMember.issue.experienceLevelUnknown");
    case "gender_unknown":
      return translate("newMember.issue.genderUnknown");
    case "auf_number_missing":
      return translate("newMember.issue.aufNumberMissing");
    case "auf_number_too_long":
      return translate("newMember.issue.aufNumberTooLong", {
        max: AUF_NUMBER_MAX_LENGTH,
      });
    case "auf_expiry_not_a_date":
      return translate("newMember.issue.aufExpiryNotADate");
    case "auf_expiry_before_joined":
      return translate("newMember.issue.aufExpiryInThePast");
  }
}

/** Por qué no salió el alta o el reenvío, en el idioma de la pantalla. */
export function describeNewMemberFailure(
  translate: Translator,
  { failure, reason }: NewMemberFailure,
): string {
  if (reason === EMAIL_TAKEN_REASON) {
    return translate("newMember.error.emailTaken");
  }
  if (reason === GROUP_NOT_FOUND_REASON) {
    return translate("newMember.error.groupNotFound");
  }
  if (reason === INVITATION_NOT_SENT_REASON) {
    return translate("newMember.error.invitationNotSent");
  }
  switch (failure) {
    case "network":
      return translate("auth.error.network");
    case "unauthenticated":
      return translate("memberRecord.error.signInRequired");
    case "forbidden":
      return translate("newMember.error.forbidden");
    case "rate_limited":
      return translate("newMember.error.rateLimited");
    default:
      return translate("newMember.error.unexpected");
  }
}
