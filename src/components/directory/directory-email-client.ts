import { z } from "zod";
import {
  type ApiRequestFailure,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { DIRECTORY_EMAILS_API_PATH } from "@/lib/auth/routes";
import {
  DIRECTORY_EMAIL_DUPLICATE_REASON,
  DIRECTORY_EMAIL_FORBIDDEN_REASON,
  DIRECTORY_EMAIL_QUOTA_EXCEEDED_REASON,
  DIRECTORY_EMAIL_UNAVAILABLE_REASON,
  type DirectoryEmailDraft,
  type DirectoryEmailQuota,
  type DirectoryEmailResult,
  NO_DIRECTORY_EMAIL_RECIPIENTS_REASON,
} from "@/lib/directory/directory-email-rules";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Lo que la pantalla del directorio le pide a `/api/v1/directory/emails`
 * (#501) y cómo reduce la respuesta a algo que pintar. Todo pasa por el
 * endpoint: la aplicación nativa de Release 2 usará el mismo camino
 * (CON-002). De un error se guarda el motivo y no la frase, para que el aviso
 * cambie de idioma con el interruptor (E17).
 */

const quotaSchema = z.object({
  data: z.object({
    limit: z.number().int(),
    remaining: z.number().int(),
  }),
});

const resultSchema = z.object({
  data: z.object({
    sentCount: z.number().int(),
    failed: z.array(z.object({ userId: z.uuid(), fullName: z.string() })),
    remaining: z.number().int(),
  }),
});

export type QuotaOutcome =
  | { readonly kind: "loaded"; readonly quota: DirectoryEmailQuota }
  | ApiRequestFailure;

export type SendOutcome =
  | { readonly kind: "sent"; readonly result: DirectoryEmailResult }
  | ApiRequestFailure;

export async function loadDirectoryEmailQuota(): Promise<QuotaOutcome> {
  const read = readApiPayload(
    await requestApi(DIRECTORY_EMAILS_API_PATH),
    quotaSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", quota: read.value.data };
}

export async function sendDirectoryEmailRequest(request: {
  readonly requestId: string;
  readonly draft: DirectoryEmailDraft;
  readonly recipientIds: readonly string[];
}): Promise<SendOutcome> {
  const read = readApiPayload(
    await requestApi(DIRECTORY_EMAILS_API_PATH, {
      method: "POST",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify({
        requestId: request.requestId,
        subject: request.draft.subject,
        message: request.draft.message,
        recipientIds: request.recipientIds,
      }),
    }),
    resultSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "sent", result: read.value.data };
}

export function isQuotaExceeded(failure: ApiRequestFailure): boolean {
  return failure.reason === DIRECTORY_EMAIL_QUOTA_EXCEEDED_REASON;
}

/** Los motivos que el endpoint nombra en `reason` cuando dice que no. El de
 * no caber lo explica `describeQuotaExceeded`, con cuántos caben. */
const FAILURE_MESSAGE_KEYS = {
  [DIRECTORY_EMAIL_UNAVAILABLE_REASON]: "directory.email.error.unavailable",
  [DIRECTORY_EMAIL_DUPLICATE_REASON]: "directory.email.error.duplicate",
  [DIRECTORY_EMAIL_FORBIDDEN_REASON]: "directory.email.error.forbidden",
  [NO_DIRECTORY_EMAIL_RECIPIENTS_REASON]: "directory.email.error.noRecipients",
} as const;

function isKnownReason(
  reason: string | null,
): reason is keyof typeof FAILURE_MESSAGE_KEYS {
  return reason !== null && Object.hasOwn(FAILURE_MESSAGE_KEYS, reason);
}

/** Por qué no salió el correo, en el idioma de la pantalla. */
export function describeDirectoryEmailFailure(
  translate: Translator,
  { failure, reason }: ApiRequestFailure,
): string {
  if (isKnownReason(reason)) {
    return translate(FAILURE_MESSAGE_KEYS[reason]);
  }
  return failure === "network"
    ? translate("auth.error.network")
    : translate("directory.email.error.unexpected");
}

/** `remaining` es `null` si no se pudo volver a leer el cupo. */
export function describeQuotaExceeded(
  translate: Translator,
  remaining: number | null,
): string {
  return remaining === null
    ? translate("directory.email.error.quotaExceededUnknown")
    : translate("directory.email.error.quotaExceeded", { count: remaining });
}
