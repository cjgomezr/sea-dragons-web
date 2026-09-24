import { z } from "zod";
import {
  type ApiRequestFailure,
  type ApiRequestOutcome,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { CLUB_SETTINGS_API_PATH } from "@/lib/auth/routes";
import {
  CLUB_INITIALS_MAX_LENGTH,
  CLUB_NAME_MAX_LENGTH,
  CLUB_SETTINGS_CHANGED_REASON,
  CLUB_SETTINGS_ISSUE_CODES,
  type ClubSettings,
  type ClubSettingsIssueCode,
  type ClubSettingsSubmission,
} from "@/lib/club/club-settings";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Lo que la configuración del club (#296) le pide a la API v1 y cómo reduce
 * cada respuesta a algo que pintar. Nada habla con la base: la aplicación
 * nativa de Release 2 usará este mismo camino (CON-002). De un error se
 * guarda el código y no la frase, para que el aviso cambie de idioma con el
 * interruptor (E17).
 */

const settingsSchema = z.object({
  name: z.string(),
  initials: z.string().nullable(),
  accentColor: z.string(),
  logoUrl: z.url({ protocol: /^https?$/ }).nullable(),
});

const responseSchema = z.object({ data: settingsSchema });

export type ClubSettingsFailure = ApiRequestFailure;

export type ClubSettingsRead =
  | { readonly kind: "loaded"; readonly settings: ClubSettings }
  | ClubSettingsFailure;

async function readSettingsResponse(
  request: Promise<ApiRequestOutcome>,
): Promise<ClubSettingsRead> {
  const read = readApiPayload(await request, responseSchema);
  return read.kind === "failed"
    ? read
    : { kind: "loaded", settings: read.value.data };
}

export function loadClubSettings(): Promise<ClubSettingsRead> {
  return readSettingsResponse(requestApi(CLUB_SETTINGS_API_PATH));
}

/** El cuerpo que espera la API: los campos nuevos planos, y lo que había al
 * abrir la pantalla en `expected`. */
export function saveClubSettings({
  identity,
  expected,
}: ClubSettingsSubmission): Promise<ClubSettingsRead> {
  return readSettingsResponse(
    requestApi(CLUB_SETTINGS_API_PATH, {
      method: "PATCH",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify({ ...identity, expected }),
    }),
  );
}

/** El campo del que habla un 400, si el `reason` es uno de esta pantalla. */
export function readIssueCode(
  failure: ClubSettingsFailure,
): ClubSettingsIssueCode | null {
  if (failure.failure !== "validation_error") {
    return null;
  }
  return (
    CLUB_SETTINGS_ISSUE_CODES.find((code) => code === failure.reason) ?? null
  );
}

export function isSettingsConflict(failure: ClubSettingsFailure): boolean {
  return failure.reason === CLUB_SETTINGS_CHANGED_REASON;
}

export function describeClubSettingsIssue(
  translate: Translator,
  code: ClubSettingsIssueCode,
): string {
  switch (code) {
    case "name_required":
      return translate("clubSettings.issue.nameRequired");
    case "name_too_long":
      return translate("clubSettings.issue.nameTooLong", {
        max: CLUB_NAME_MAX_LENGTH,
      });
    case "initials_too_long":
      return translate("clubSettings.issue.initialsTooLong", {
        max: CLUB_INITIALS_MAX_LENGTH,
      });
    case "accent_color_invalid":
      return translate("clubSettings.issue.accentInvalid");
    case "accent_color_no_readable_text":
      return translate("clubSettings.issue.accentNoReadableText");
    case "accent_color_unreadable_on_background":
      return translate("clubSettings.issue.accentUnreadableOnBackground");
  }
}

/** Por qué no se pudo leer o guardar la configuración, en el idioma de la
 * pantalla. */
export function describeClubSettingsFailure(
  translate: Translator,
  failure: ClubSettingsFailure,
): string {
  if (isSettingsConflict(failure)) {
    return translate("clubSettings.error.changed");
  }
  switch (failure.failure) {
    case "network":
      return translate("auth.error.network");
    case "unauthenticated":
      return translate("clubSettings.error.signInRequired");
    case "forbidden":
      return translate("clubSettings.error.forbidden");
    default:
      return translate("clubSettings.error.unexpected");
  }
}
