import { z } from "zod";
import {
  type ApiRequestFailure,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { ACCOUNT_PROFILE_PHOTO_API_PATH } from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import {
  PROFILE_PHOTO_ISSUE_CODES,
  PROFILE_PHOTO_MAX_BYTES,
  type ProfilePhotoIssueCode,
} from "@/lib/members/profile-photo";

/**
 * Subir y quitar la foto de perfil propia (#245) por la API v1, y decir en el
 * idioma de la pantalla por qué no salió. Como en los demás formularios de la
 * cuenta, se guarda el código y no la frase.
 */

const BYTES_PER_MEGABYTE = 1024 * 1024;
const MAX_MEGABYTES = PROFILE_PHOTO_MAX_BYTES / BYTES_PER_MEGABYTE;

const photoResponseSchema = z.object({
  data: z.object({ photoUrl: z.url({ protocol: /^https?$/ }) }),
});

export type PhotoUploadResult =
  { readonly kind: "saved"; readonly photoUrl: string } | ApiRequestFailure;

export type PhotoRemovalResult =
  { readonly kind: "removed" } | ApiRequestFailure;

/** Los bytes van tal cual en el cuerpo: el servidor mira el tipo en ellos. */
export async function uploadProfilePhoto(
  file: File,
): Promise<PhotoUploadResult> {
  const read = readApiPayload(
    await requestApi(ACCOUNT_PROFILE_PHOTO_API_PATH, {
      method: "PUT",
      headers: { "content-type": file.type },
      body: file,
    }),
    photoResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "saved", photoUrl: read.value.data.photoUrl };
}

export async function removeOwnProfilePhoto(): Promise<PhotoRemovalResult> {
  const outcome = await requestApi(ACCOUNT_PROFILE_PHOTO_API_PATH, {
    method: "DELETE",
  });
  return outcome.kind === "failed" ? outcome : { kind: "removed" };
}

export function describePhotoIssue(
  translate: Translator,
  code: ProfilePhotoIssueCode,
): string {
  switch (code) {
    case "photo_empty":
      return translate("account.photo.issue.photoEmpty");
    case "photo_too_large":
      return translate("account.photo.issue.photoTooLarge", {
        max: MAX_MEGABYTES,
      });
    case "photo_type_unsupported":
      return translate("account.photo.issue.photoTypeUnsupported");
  }
}

export function describePhotoHint(translate: Translator): string {
  return translate("account.photo.hint", { max: MAX_MEGABYTES });
}

/** El motivo de un 400 que la pantalla sabe explicar, o null. */
export function readPhotoIssue(
  failure: ApiRequestFailure,
): ProfilePhotoIssueCode | null {
  if (failure.failure !== "validation_error") {
    return null;
  }
  return (
    PROFILE_PHOTO_ISSUE_CODES.find((code) => code === failure.reason) ?? null
  );
}

/** Lo que el servidor puede responder que no, en el idioma de la pantalla. */
export function describePhotoFailure(
  translate: Translator,
  failure: ApiRequestFailure,
): string {
  const issue = readPhotoIssue(failure);
  if (issue !== null) {
    return describePhotoIssue(translate, issue);
  }
  switch (failure.failure) {
    case "network":
      return translate("account.photo.error.network");
    case "unauthenticated":
      return translate("account.photo.error.signInRequired");
    case "forbidden":
      return translate("account.photo.error.forbidden");
    default:
      return translate("account.photo.error.unexpected");
  }
}
