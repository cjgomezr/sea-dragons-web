"use client";

import { useRef, useState } from "react";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import type { NewsAttachmentIssueCode } from "@/lib/news/news-attachments";
import type { NewsImageIssueCodes } from "@/lib/news/news-cover-uploads";
import { newsInlineImageUrlOf } from "@/lib/news/news-inline-image-urls";
import {
  readAttachmentIssue,
  uploadNewsInlineImage,
} from "./news-publish-client";
import { checkNewsImageBeforeUpload } from "./use-news-cover";

/**
 * Subir las imágenes del cuerpo desde el editor (#603, RF-14 del PRD de
 * E22). Vive en el formulario y no en el editor porque publicar espera a que
 * acaben, como con la portada y los adjuntos. Dónde se inserta cada una lo
 * decide el editor, que es quien tiene el cursor.
 *
 * Una imagen subida y luego borrada del texto no se borra desde aquí: el
 * servidor barre las que ninguna publicación ligó.
 */

/** Por qué la imagen elegida no valió. Se guarda el motivo y no la frase,
 * para que cambie de idioma con el interruptor. */
export type NewsInlineImageIssue =
  | { readonly kind: "rejected"; readonly code: NewsAttachmentIssueCode }
  | { readonly kind: "uploadFailed"; readonly failure: ApiRequestFailure };

export type NewsInlineImageUploadOutcome =
  /** La dirección estable que va en el cuerpo. */
  | { readonly kind: "uploaded"; readonly url: string }
  | { readonly kind: "rejected"; readonly issue: NewsInlineImageIssue };

export type NewsInlineImageUploader = {
  readonly isUploading: boolean;
  readonly upload: (file: File) => Promise<NewsInlineImageUploadOutcome>;
};

const INLINE_IMAGE_ISSUES: NewsImageIssueCodes = {
  empty: "inline_image_empty",
  tooLarge: "inline_image_too_large",
  typeUnsupported: "inline_image_type_unsupported",
};

function uploadFailureIssue(failure: ApiRequestFailure): NewsInlineImageIssue {
  const code = readAttachmentIssue(failure);
  return code === null
    ? { kind: "uploadFailed", failure }
    : { kind: "rejected", code };
}

async function uploadChecked(
  file: File,
): Promise<NewsInlineImageUploadOutcome> {
  const result = await uploadNewsInlineImage(file);
  return result.kind === "uploaded"
    ? { kind: "uploaded", url: newsInlineImageUrlOf(result.upload.id) }
    : { kind: "rejected", issue: uploadFailureIssue(result) };
}

export function useNewsInlineImageUpload(): NewsInlineImageUploader {
  // Se pueden elegir varias seguidas: publicar espera a la última.
  const [pendingCount, setPendingCount] = useState(0);
  const pending = useRef(0);

  function track(change: 1 | -1): void {
    pending.current += change;
    setPendingCount(pending.current);
  }

  async function upload(file: File): Promise<NewsInlineImageUploadOutcome> {
    const code = checkNewsImageBeforeUpload(file, INLINE_IMAGE_ISSUES);
    if (code !== null) {
      return { kind: "rejected", issue: { kind: "rejected", code } };
    }
    track(1);
    try {
      return await uploadChecked(file);
    } finally {
      track(-1);
    }
  }

  return { isUploading: pendingCount > 0, upload };
}
