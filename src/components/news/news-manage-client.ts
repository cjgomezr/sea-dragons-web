import { z } from "zod";
import {
  type ApiRequestFailure,
  type ApiRequestOutcome,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import {
  NEWS_POST_MANAGE_API_PATH,
  NEWS_POST_STATUS_API_PATH,
} from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import type { EditableNewsPost } from "@/lib/news/news-management";
import {
  NEWS_CATEGORIES,
  type NewsDraft,
  type NewsPostDetail,
  type NewsPostStatus,
} from "@/lib/news/news-posts";
import { newsPostDetailSchema } from "./news-client";

/**
 * Lo que editar y retirar (#331) le piden a la API v1. Como el resto de
 * Noticias, nada habla con la base: la aplicación nativa de Release 2 usará
 * estos mismos caminos (CON-002). Qué se puede tocar lo decide el servidor.
 */

const editableResponseSchema = z.object({
  data: z.object({
    id: z.uuid(),
    category: z.enum(NEWS_CATEGORIES),
    title: z.string(),
    body: z.string(),
    audience: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("club") }),
      z.object({ kind: z.literal("groups"), groupIds: z.array(z.uuid()) }),
    ]),
    editedAt: z.iso.datetime({ offset: true }).nullable(),
    status: z.enum(["published", "withdrawn"]),
  }),
});

const postResponseSchema = z.object({ data: newsPostDetailSchema });

export type EditableNewsPostLoad =
  | { readonly kind: "loaded"; readonly post: EditableNewsPost }
  | ApiRequestFailure;

export type NewsPostChange =
  { readonly kind: "saved"; readonly post: NewsPostDetail } | ApiRequestFailure;

/** La edición que se manda: el borrador y la marca de editada que se tenía
 * delante, que es con lo que el servidor detecta un conflicto. */
export type NewsEditSubmission = NewsDraft & {
  readonly expectedEditedAt: string | null;
};

function managePath(postId: string): string {
  return NEWS_POST_MANAGE_API_PATH.replace("[id]", encodeURIComponent(postId));
}

function readSavedPost(outcome: ApiRequestOutcome): NewsPostChange {
  const read = readApiPayload(outcome, postResponseSchema);
  return read.kind === "failed"
    ? read
    : { kind: "saved", post: read.value.data };
}

export async function loadEditableNewsPost(
  postId: string,
): Promise<EditableNewsPostLoad> {
  const read = readApiPayload(
    await requestApi(managePath(postId)),
    editableResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", post: read.value.data };
}

export async function saveNewsEdit(
  postId: string,
  submission: NewsEditSubmission,
): Promise<NewsPostChange> {
  return readSavedPost(
    await requestApi(managePath(postId), {
      method: "PATCH",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify(submission),
    }),
  );
}

/** Retirar (`withdrawn`) o volver a publicar (`published`). */
export async function changeNewsStatus(
  postId: string,
  status: NewsPostStatus,
): Promise<NewsPostChange> {
  return readSavedPost(
    await requestApi(
      NEWS_POST_STATUS_API_PATH.replace("[id]", encodeURIComponent(postId)),
      {
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify({ status }),
      },
    ),
  );
}

/** Por qué no se guardó la edición, en el idioma de la pantalla. */
export function describeEditFailure(
  translate: Translator,
  failure: ApiRequestFailure,
): string {
  switch (failure.failure) {
    case "network":
      return translate("news.publish.error.network");
    case "unauthenticated":
      return translate("news.publish.error.signInRequired");
    case "forbidden":
      return translate("news.edit.forbidden");
    case "conflict":
      return translate("news.edit.error.conflict");
    default:
      return translate("news.edit.error.unexpected");
  }
}
