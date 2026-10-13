import { z } from "zod";
import {
  type ApiRequestFailure,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { NEWS_POST_PIN_API_PATH } from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import { NEWS_POST_WITHDRAWN_REASON } from "@/lib/news/news-pin-rule";
import { newsPostDetailSchema } from "./news-client";

/**
 * Fijar y desfijar (#595) por la API v1 (#592). Que solo el Admin pueda lo
 * decide el servidor (D1); la pantalla manda lo elegido y se recoloca con lo
 * que respondió.
 */

const pinnedResponseSchema = z.object({
  data: newsPostDetailSchema.pick({ pinnedUntil: true }),
});

export type PinAction = "pin" | "unpin";

export type NewsPinOutcome =
  | { readonly kind: "pinned"; readonly pinnedUntil: string | null }
  | ApiRequestFailure;

export type NewsUnpinOutcome =
  { readonly kind: "unpinned" } | ApiRequestFailure;

function pinPath(postId: string): string {
  return NEWS_POST_PIN_API_PATH.replace("[id]", encodeURIComponent(postId));
}

/** Fija hasta `until`, o sin fecha de fin con `null`. */
export async function pinNewsPost(
  postId: string,
  until: string | null,
): Promise<NewsPinOutcome> {
  const read = readApiPayload(
    await requestApi(pinPath(postId), {
      method: "POST",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify({ until }),
    }),
    pinnedResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "pinned", pinnedUntil: read.value.data.pinnedUntil };
}

export async function unpinNewsPost(postId: string): Promise<NewsUnpinOutcome> {
  const outcome = await requestApi(pinPath(postId), { method: "DELETE" });
  return outcome.kind === "failed" ? outcome : { kind: "unpinned" };
}

/** Por qué no se fijó o desfijó, en el idioma de la pantalla. */
export function describePinFailure(
  translate: Translator,
  action: PinAction,
  { failure, reason }: ApiRequestFailure,
): string {
  if (reason === NEWS_POST_WITHDRAWN_REASON) {
    return translate("news.pin.error.withdrawn");
  }
  switch (failure) {
    case "network":
      return translate("auth.error.network");
    case "unauthenticated":
      return translate("news.pin.error.signInRequired");
    case "forbidden":
      return translate("news.pin.error.forbidden");
    default:
      return translate(
        action === "pin"
          ? "news.pin.error.pinUnexpected"
          : "news.pin.error.unpinUnexpected",
      );
  }
}
