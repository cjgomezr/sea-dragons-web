import type { NextRequest } from "next/server";
import { z } from "zod";
import { readLimitedBody } from "@/lib/api/read-limited-body";
import { ApiError } from "@/lib/api/response";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  NEWS_ATTACHMENT_MAX_BYTES,
  type NewsAttachmentGateways,
  type NewsAttachmentIssueCode,
  NewsAttachmentNotFoundError,
  NewsAttachmentValidationError,
} from "./news-attachments";
import { asNewsApiError } from "./news-api";
import type { NewsPublishGateways } from "./news-publication-notice";
import { createSupabaseNewsAttachmentGateways } from "./supabase-news-attachment-gateways";
import { createSupabaseNewsPublishGateways } from "./supabase-news-publish-gateways";

/**
 * Lo que comparten los endpoints de adjuntos (#328): cómo se cablean, cómo
 * leen la subida y el id del adjunto, y cómo responde cada error.
 *
 * Un archivo rechazado es un `validation_error` con el motivo en `reason`,
 * como la foto de perfil: la pantalla lo traduce.
 */

/** El nombre con el que se subió va en la consulta y no en una cabecera
 * propia: así lo manda igual un `fetch` del navegador que la aplicación
 * nativa, sin codificar nada a mano. */
export const NEWS_ATTACHMENT_FILE_NAME_PARAM = "name";

/** Qué se sube por el flujo de subidas previas: un adjunto (lo de siempre,
 * sin el parámetro), la portada (#591) o una imagen del cuerpo (#603). */
export const NEWS_UPLOAD_KIND_PARAM = "kind";

export const NEWS_UPLOAD_KINDS = [
  "attachment",
  "cover",
  "inline_image",
] as const;

export type NewsUploadKind = (typeof NEWS_UPLOAD_KINDS)[number];

const TOO_LARGE_CODES: Readonly<
  Record<NewsUploadKind, NewsAttachmentIssueCode>
> = {
  attachment: "attachment_too_large",
  cover: "cover_too_large",
  inline_image: "inline_image_too_large",
};

export type NewsAttachmentUpload = {
  readonly fileName: string;
  readonly bytes: Uint8Array;
};

function rejectFile(code: NewsAttachmentIssueCode): never {
  const error = new NewsAttachmentValidationError(code);
  throw new ApiError("validation_error", error.message, code);
}

/** Qué se sube. Sin el parámetro es un adjunto, como antes de #591. */
export function readNewsUploadKind(request: NextRequest): NewsUploadKind {
  const kind = request.nextUrl.searchParams.get(NEWS_UPLOAD_KIND_PARAM);
  if (kind === null) {
    return "attachment";
  }
  const known = NEWS_UPLOAD_KINDS.find((candidate) => candidate === kind);
  if (known === undefined) {
    throw new ApiError(
      "validation_error",
      `El tipo de subida tiene que ser uno de: ${NEWS_UPLOAD_KINDS.join(", ")}.`,
    );
  }
  return known;
}

/** El nombre y los bytes de la subida. El cuerpo se lee como mucho hasta el
 * límite: un archivo de más se rechaza sin cargarlo entero, con el código de
 * lo que se subía. */
export async function readNewsAttachmentUpload(
  request: NextRequest,
  kind: NewsUploadKind = "attachment",
): Promise<NewsAttachmentUpload> {
  const fileName = request.nextUrl.searchParams.get(
    NEWS_ATTACHMENT_FILE_NAME_PARAM,
  );
  if (fileName === null) {
    rejectFile("attachment_name_invalid");
  }
  const body = await readLimitedBody(request, NEWS_ATTACHMENT_MAX_BYTES);
  if (body.kind === "too_large") {
    rejectFile(TOO_LARGE_CODES[kind]);
  }
  return { fileName, bytes: body.bytes };
}

/** Un id que no es un uuid no puede nombrar ningún adjunto ni ninguna subida
 * previa (#330). En una subida, además, es parte de la ruta del fichero: sin
 * esto, `..` subiría de carpeta. */
export function readNewsAttachmentId(value: string): string {
  if (!z.uuid().safeParse(value).success) {
    throw new ApiError("not_found", new NewsAttachmentNotFoundError().message);
  }
  return value;
}

export function requireNewsAttachmentGateways(): NewsAttachmentGateways {
  const wiring = createSupabaseNewsAttachmentGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

export function requireNewsPublishGateways(): NewsPublishGateways {
  const wiring = createSupabaseNewsPublishGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

export function asNewsAttachmentApiError(error: unknown): never {
  if (error instanceof NewsAttachmentValidationError) {
    rejectFile(error.code);
  }
  if (error instanceof NewsAttachmentNotFoundError) {
    throw new ApiError("not_found", error.message);
  }
  return asNewsApiError(error);
}
