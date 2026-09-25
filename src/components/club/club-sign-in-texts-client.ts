import { z } from "zod";
import {
  type ApiRequestFailure,
  type ApiRequestOutcome,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { CLUB_SIGN_IN_TEXTS_API_PATH } from "@/lib/auth/routes";
import {
  SIGN_IN_TEXT_FIELDS,
  type SignInTextField,
  type SignInTextKind,
  type SignInTexts,
  signInTextMaxLength,
} from "@/lib/club/sign-in-texts";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Lo que la sección de los textos del inicio de sesión (#301) le pide a la
 * API v1 y cómo reduce cada respuesta a algo que pintar. Nada habla con la
 * base: la aplicación nativa de Release 2 usará este mismo camino (CON-002).
 */

const localeTextsSchema = z.object({
  tagline: z.string().nullable(),
  welcome: z.string().nullable(),
});

const responseSchema = z.object({
  data: z.object({ en: localeTextsSchema, es: localeTextsSchema }),
});

export type SignInTextsRead =
  { readonly kind: "loaded"; readonly texts: SignInTexts } | ApiRequestFailure;

async function readTextsResponse(
  request: Promise<ApiRequestOutcome>,
): Promise<SignInTextsRead> {
  const read = readApiPayload(await request, responseSchema);
  return read.kind === "failed"
    ? read
    : { kind: "loaded", texts: read.value.data };
}

export function loadSignInTexts(): Promise<SignInTextsRead> {
  return readTextsResponse(requestApi(CLUB_SIGN_IN_TEXTS_API_PATH));
}

export function saveSignInTexts(texts: SignInTexts): Promise<SignInTextsRead> {
  return readTextsResponse(
    requestApi(CLUB_SIGN_IN_TEXTS_API_PATH, {
      method: "PUT",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify(texts),
    }),
  );
}

/** El campo del que habla un 400 (`es.tagline_too_long`), si es uno de esta
 * sección. */
export function readSignInTextIssueField(
  failure: ApiRequestFailure,
): SignInTextField | null {
  if (failure.failure !== "validation_error") {
    return null;
  }
  return (
    SIGN_IN_TEXT_FIELDS.find(
      ({ locale, kind }) => failure.reason === `${locale}.${kind}_too_long`,
    ) ?? null
  );
}

export function describeSignInTextTooLong(
  translate: Translator,
  kind: SignInTextKind,
): string {
  const max = signInTextMaxLength(kind);
  switch (kind) {
    case "tagline":
      return translate("clubSettings.signInTexts.issue.taglineTooLong", {
        max,
      });
    case "welcome":
      return translate("clubSettings.signInTexts.issue.welcomeTooLong", {
        max,
      });
  }
}
