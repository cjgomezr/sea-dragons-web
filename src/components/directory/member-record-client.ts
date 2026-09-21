import { z } from "zod";
import {
  type ApiRequestFailure,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { MEMBER_RECORD_API_PATH } from "@/lib/auth/routes";
import type { Group } from "@/lib/groups/groups";
import { formatCalendarDay } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import {
  AUF_NUMBER_MAX_LENGTH,
  GROUP_NOT_FOUND_REASON,
  MEMBER_INACTIVE_REASON,
  MEMBER_NOT_FOUND_REASON,
  MEMBER_RECORD_ISSUE_CODES,
  type MemberRecord,
  type MemberRecordIssueCode,
  type MemberRecordSubmission,
} from "@/lib/members/member-record";
import { loadGroups } from "@/components/groups/groups-client";

/**
 * Lo que la ficha reservada al Admin (#242) le pide a la API v1 y cómo reduce
 * cada respuesta a algo que pintar.
 *
 * Nada habla con la base: el endpoint es el producto, y la aplicación nativa
 * de Release 2 va a usar este mismo camino (CON-002). Los grupos que se
 * ofrecen salen de `GET /api/v1/groups`, el mismo que lee la sección Grupos.
 * De un error se guarda el código y no la frase, para que el aviso cambie de
 * idioma con el interruptor (E17).
 */

const recordSchema = z.object({
  userId: z.uuid(),
  fullName: z.string(),
  joinedOn: z.string(),
  aufNumber: z.string().nullable(),
  aufExpiry: z.string().nullable(),
  isAufExpired: z.boolean(),
  groups: z.array(z.object({ id: z.uuid(), name: z.string() })),
});

const responseSchema = z.object({ data: recordSchema });

export type MemberRecordFailure = ApiRequestFailure;

export type MemberRecordLoad =
  | {
      readonly kind: "loaded";
      readonly record: MemberRecord;
      readonly clubGroups: readonly Group[];
    }
  | MemberRecordFailure;

export type MemberRecordSave =
  | { readonly kind: "saved"; readonly record: MemberRecord }
  | MemberRecordFailure;

function recordPath(userId: string): string {
  return MEMBER_RECORD_API_PATH.replace("[id]", userId);
}

/** La ficha y los grupos del club a la vez. Si falla cualquiera de las dos no
 * hay nada que editar: la ficha sin grupos borraría los del miembro al
 * guardar. */
export async function loadMemberRecord(
  userId: string,
): Promise<MemberRecordLoad> {
  const [recordOutcome, groups] = await Promise.all([
    requestApi(recordPath(userId)),
    loadGroups(),
  ]);
  const read = readApiPayload(recordOutcome, responseSchema);
  if (read.kind === "failed") {
    return read;
  }
  if (groups.kind === "failed") {
    return groups;
  }
  return { kind: "loaded", record: read.value.data, clubGroups: groups.groups };
}

export async function saveMemberRecord(
  userId: string,
  submission: MemberRecordSubmission,
): Promise<MemberRecordSave> {
  const read = readApiPayload(
    await requestApi(recordPath(userId), {
      method: "PATCH",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify(submission),
    }),
    responseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "saved", record: read.value.data };
}

/** El campo del que habla un 400, si el `reason` es uno de la ficha. */
export function readIssueCode(
  failure: MemberRecordFailure,
): MemberRecordIssueCode | null {
  if (failure.failure !== "validation_error") {
    return null;
  }
  return (
    MEMBER_RECORD_ISSUE_CODES.find((code) => code === failure.reason) ?? null
  );
}

export function describeMemberRecordIssue(
  translate: Translator,
  {
    code,
    locale,
    joinedOn,
  }: {
    readonly code: MemberRecordIssueCode;
    readonly locale: Locale;
    readonly joinedOn: string;
  },
): string {
  switch (code) {
    case "auf_number_too_long":
      return translate("memberRecord.issue.aufNumberTooLong", {
        max: AUF_NUMBER_MAX_LENGTH,
      });
    case "auf_expiry_not_a_date":
      return translate("memberRecord.issue.aufExpiryNotADate");
    case "auf_expiry_before_joined":
      return translate("memberRecord.issue.aufExpiryBeforeJoined", {
        date: formatCalendarDay(locale, joinedOn),
      });
  }
}

/** Por qué no se pudo leer o guardar la ficha, en el idioma de la pantalla.
 * Un 404 puede ser del miembro o de un grupo, y el `reason` dice cuál. */
export function describeMemberRecordFailure(
  translate: Translator,
  { failure, reason }: MemberRecordFailure,
): string {
  if (reason === MEMBER_NOT_FOUND_REASON) {
    return translate("memberRecord.error.memberNotFound");
  }
  if (reason === GROUP_NOT_FOUND_REASON) {
    return translate("memberRecord.error.groupNotFound");
  }
  if (reason === MEMBER_INACTIVE_REASON) {
    return translate("memberRecord.error.memberInactive");
  }
  switch (failure) {
    case "network":
      return translate("auth.error.network");
    case "unauthenticated":
      return translate("memberRecord.error.signInRequired");
    case "forbidden":
      return translate("memberRecord.error.forbidden");
    default:
      return translate("memberRecord.error.unexpected");
  }
}
