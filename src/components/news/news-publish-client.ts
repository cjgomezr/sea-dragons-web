import { z } from "zod";
import {
  type ApiRequestFailure,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import {
  NEWS_PUBLISH_API_PATH,
  NEWS_UPLOAD_API_PATH,
  NEWS_UPLOADS_API_PATH,
} from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import {
  NEWS_ATTACHMENT_ISSUE_CODES,
  NEWS_ATTACHMENT_MAX_BYTES,
  NEWS_ATTACHMENTS_MAX_PER_POST,
  type NewsAttachmentIssueCode,
} from "@/lib/news/news-attachments";
import type { NewsDraftIssueCode } from "@/lib/news/news-draft";
import {
  NEWS_CATEGORIES,
  NEWS_TITLE_MAX_LENGTH,
  type NewsAttachmentSummary,
  type NewsDraft,
} from "@/lib/news/news-posts";

/**
 * Lo que el formulario de publicar (#330) le pide a la API v1: subir y quitar
 * un adjunto mientras se escribe, y publicar. Nada habla con la base, porque
 * la aplicación nativa de Release 2 va a usar estos mismos caminos (CON-002).
 * De un error se guarda el código, y la frase se arma al pintar, en el idioma
 * de la pantalla (E17).
 */

const BYTES_PER_MEGABYTE = 1024 * 1024;
const MAX_MEGABYTES = NEWS_ATTACHMENT_MAX_BYTES / BYTES_PER_MEGABYTE;
const FILE_NAME_PARAM = "name";

const attachmentSchema = z.object({
  id: z.uuid(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});

const uploadResponseSchema = z.object({ data: attachmentSchema });

const publishedResponseSchema = z.object({
  data: z.object({ id: z.uuid(), category: z.enum(NEWS_CATEGORIES) }),
});

export type NewsUploadResult =
  | { readonly kind: "uploaded"; readonly upload: NewsAttachmentSummary }
  | ApiRequestFailure;

export type NewsUploadRemoval =
  { readonly kind: "removed" } | ApiRequestFailure;

export type NewsPublishResult =
  { readonly kind: "published"; readonly postId: string } | ApiRequestFailure;

export type NewsSubmission = NewsDraft & {
  readonly attachmentUploadIds: readonly string[];
};

/** Los bytes van tal cual en el cuerpo, y el nombre en la consulta, como en
 * #328: el servidor mira el tipo en los bytes. */
export async function uploadNewsAttachment(
  file: File,
): Promise<NewsUploadResult> {
  const params = new URLSearchParams({ [FILE_NAME_PARAM]: file.name });
  const read = readApiPayload(
    await requestApi(`${NEWS_UPLOADS_API_PATH}?${params.toString()}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    }),
    uploadResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "uploaded", upload: read.value.data };
}

/** Una subida que ya no está también se da por quitada: lo que se quería es
 * que desapareciera. */
export async function removeNewsUpload(
  uploadId: string,
): Promise<NewsUploadRemoval> {
  const outcome = await requestApi(
    NEWS_UPLOAD_API_PATH.replace("[uploadId]", encodeURIComponent(uploadId)),
    { method: "DELETE" },
  );
  if (outcome.kind === "failed" && outcome.failure !== "not_found") {
    return outcome;
  }
  return { kind: "removed" };
}

export async function publishNews(
  submission: NewsSubmission,
): Promise<NewsPublishResult> {
  const read = readApiPayload(
    await requestApi(NEWS_PUBLISH_API_PATH, {
      method: "POST",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify(submission),
    }),
    publishedResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "published", postId: read.value.data.id };
}

/** Por qué un archivo no vale, en el idioma de la pantalla. */
export function describeAttachmentIssue(
  translate: Translator,
  code: NewsAttachmentIssueCode,
): string {
  switch (code) {
    case "attachment_empty":
      return translate("news.publish.attachments.issue.empty");
    case "attachment_too_large":
      return translate("news.publish.attachments.issue.tooLarge", {
        max: MAX_MEGABYTES,
      });
    case "attachment_type_unsupported":
      return translate("news.publish.attachments.issue.typeUnsupported");
    case "attachment_type_mismatch":
      return translate("news.publish.attachments.issue.typeMismatch");
    case "attachment_name_invalid":
      return translate("news.publish.attachments.issue.nameInvalid");
    case "attachment_limit_reached":
      return translate("news.publish.attachments.issue.limitReached", {
        max: NEWS_ATTACHMENTS_MAX_PER_POST,
      });
    case "attachment_upload_missing":
      return translate("news.publish.attachments.issue.uploadMissing");
  }
}

/** El motivo de un 400 que la pantalla sabe explicar, o null. */
export function readAttachmentIssue(
  failure: ApiRequestFailure,
): NewsAttachmentIssueCode | null {
  if (failure.failure !== "validation_error") {
    return null;
  }
  return (
    NEWS_ATTACHMENT_ISSUE_CODES.find((code) => code === failure.reason) ?? null
  );
}

/** Lo que el servidor puede responder que no, en el idioma de la pantalla. */
export function describePublishFailure(
  translate: Translator,
  failure: ApiRequestFailure,
): string {
  const issue = readAttachmentIssue(failure);
  if (issue !== null) {
    return describeAttachmentIssue(translate, issue);
  }
  switch (failure.failure) {
    case "network":
      return translate("news.publish.error.network");
    case "unauthenticated":
      return translate("news.publish.error.signInRequired");
    case "forbidden":
      return translate("news.publish.error.forbidden");
    default:
      return translate("news.publish.error.unexpected");
  }
}

export function describeDraftIssue(
  translate: Translator,
  code: NewsDraftIssueCode,
): string {
  switch (code) {
    case "title_missing":
      return translate("news.publish.issue.titleMissing");
    case "title_too_long":
      return translate("news.publish.issue.titleTooLong", {
        max: NEWS_TITLE_MAX_LENGTH,
      });
    case "body_missing":
      return translate("news.publish.issue.bodyMissing");
    case "audience_groups_empty":
      return translate("news.publish.issue.audienceGroupsEmpty");
  }
}

export function describeAttachmentsHint(translate: Translator): string {
  return translate("news.publish.attachments.hint", {
    max: NEWS_ATTACHMENTS_MAX_PER_POST,
    size: MAX_MEGABYTES,
  });
}
