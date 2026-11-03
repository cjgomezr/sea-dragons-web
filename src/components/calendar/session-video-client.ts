import { z } from "zod";
import {
  type ApiRequestFailure,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { EVENT_VIDEO_API_PATH } from "@/lib/auth/routes";
import {
  SESSION_VIDEO_URL_MAX_LENGTH,
  type SessionVideoUrlIssue,
} from "@/lib/events/session-video-url";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Lo que el bloque del vídeo de una sesión (#965) le pide a la API v1 y cómo
 * reduce cada respuesta a algo que pintar. Nada habla con la base: la
 * aplicación nativa de Release 2 usará este mismo camino (CON-002).
 */

const savedVideoSchema = z.object({
  data: z.object({ eventId: z.uuid(), url: z.string() }),
});

export type SessionVideoSave =
  { readonly kind: "saved"; readonly url: string } | ApiRequestFailure;

export type SessionVideoRemoval =
  { readonly kind: "removed" } | ApiRequestFailure;

function videoPathOf(eventId: string): string {
  return EVENT_VIDEO_API_PATH.replace("[id]", encodeURIComponent(eventId));
}

export async function saveSessionVideo(
  eventId: string,
  url: string,
): Promise<SessionVideoSave> {
  const read = readApiPayload(
    await requestApi(videoPathOf(eventId), {
      method: "PUT",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify({ url }),
    }),
    savedVideoSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "saved", url: read.value.data.url };
}

export async function removeSessionVideo(
  eventId: string,
): Promise<SessionVideoRemoval> {
  const outcome = await requestApi(videoPathOf(eventId), { method: "DELETE" });
  return outcome.kind === "failed" ? outcome : { kind: "removed" };
}

const ISSUES: readonly SessionVideoUrlIssue[] = [
  "not_youtube_video",
  "too_long",
];

/** El motivo de un 400 del enlace, si es uno que el campo sabe decir. */
export function readSessionVideoIssue(
  failure: ApiRequestFailure,
): SessionVideoUrlIssue | null {
  if (failure.failure !== "validation_error") {
    return null;
  }
  return ISSUES.find((issue) => issue === failure.reason) ?? null;
}

export function describeSessionVideoIssue(
  translate: Translator,
  issue: SessionVideoUrlIssue,
): string {
  return issue === "too_long"
    ? translate("calendar.video.issue.too_long", {
        max: SESSION_VIDEO_URL_MAX_LENGTH,
      })
    : translate("calendar.video.issue.not_youtube_video");
}
