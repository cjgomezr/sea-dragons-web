import { z } from "zod";
import {
  type ApiRequestFailure,
  type ApiRequestOutcome,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { CLUB_LOGO_API_PATH } from "@/lib/auth/routes";
import {
  CLUB_LOGO_ISSUE_CODES,
  CLUB_LOGO_MAX_BYTES,
  type ClubLogoIssueCode,
} from "@/lib/club/club-logo";
import type { Translator } from "@/lib/i18n/translator";
import { describeClubSettingsFailure } from "./club-settings-client";

/**
 * Subir y quitar el logo del club (#295) por la API v1, y decir en el idioma
 * de la pantalla por qué no salió. Como en la foto de perfil, se guarda el
 * código y no la frase.
 */

const BYTES_PER_KILOBYTE = 1024;
const MAX_KILOBYTES = CLUB_LOGO_MAX_BYTES / BYTES_PER_KILOBYTE;

const logoResponseSchema = z.object({
  data: z.object({ logoUrl: z.url({ protocol: /^https?$/ }).nullable() }),
});

export type ClubLogoChange =
  | { readonly kind: "changed"; readonly logoUrl: string | null }
  | ApiRequestFailure;

function readLogoResponse(outcome: ApiRequestOutcome): ClubLogoChange {
  const read = readApiPayload(outcome, logoResponseSchema);
  return read.kind === "failed"
    ? read
    : { kind: "changed", logoUrl: read.value.data.logoUrl };
}

/** Los bytes van tal cual en el cuerpo: el servidor mira el tipo en ellos. */
export async function uploadClubLogo(file: File): Promise<ClubLogoChange> {
  return readLogoResponse(
    await requestApi(CLUB_LOGO_API_PATH, {
      method: "PUT",
      headers: { "content-type": file.type },
      body: file,
    }),
  );
}

export async function deleteClubLogo(): Promise<ClubLogoChange> {
  return readLogoResponse(
    await requestApi(CLUB_LOGO_API_PATH, { method: "DELETE" }),
  );
}

export function describeLogoIssue(
  translate: Translator,
  code: ClubLogoIssueCode,
): string {
  switch (code) {
    case "logo_empty":
      return translate("clubSettings.logo.issue.logoEmpty");
    case "logo_too_large":
      return translate("clubSettings.logo.issue.logoTooLarge", {
        max: MAX_KILOBYTES,
      });
    case "logo_type_unsupported":
      return translate("clubSettings.logo.issue.logoTypeUnsupported");
    case "logo_undecodable":
      return translate("clubSettings.logo.issue.logoUndecodable");
  }
}

export function describeLogoHint(translate: Translator): string {
  return translate("clubSettings.logo.hint", { max: MAX_KILOBYTES });
}

/** Lo que el servidor puede responder que no, en el idioma de la pantalla. */
export function describeLogoFailure(
  translate: Translator,
  failure: ApiRequestFailure,
): string {
  const issue =
    failure.failure === "validation_error"
      ? CLUB_LOGO_ISSUE_CODES.find((code) => code === failure.reason)
      : undefined;
  return issue === undefined
    ? describeClubSettingsFailure(translate, failure)
    : describeLogoIssue(translate, issue);
}
