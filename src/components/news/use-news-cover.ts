"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import {
  NEWS_ATTACHMENT_MAX_BYTES,
  type NewsAttachmentIssueCode,
} from "@/lib/news/news-attachments";
import type { NewsImageIssueCodes } from "@/lib/news/news-cover-uploads";
import type { NewsCoverChange } from "@/lib/news/news-posts";
import { readAttachmentIssue, uploadNewsCover } from "./news-publish-client";

/**
 * La portada del formulario de publicar y editar (#597, RF-8 del PRD de
 * E22). Se sube en cuanto se elige, como un adjunto, y publicar espera a que
 * termine.
 *
 * Quitarla sólo cambia el formulario: si es una edición y no se guarda, la
 * publicación conserva la suya. Una portada subida y luego quitada no se
 * borra desde aquí; el servidor barre las que nadie enlazó (#591).
 */

export type NewsCover =
  | { readonly kind: "none" }
  /** La que ya tenía la publicación que se edita. */
  | { readonly kind: "current"; readonly url: string }
  | { readonly kind: "uploading" }
  | {
      readonly kind: "uploaded";
      readonly uploadId: string;
      readonly previewUrl: string;
    };

/** Por qué la portada elegida no valió. Se guarda el motivo y no la frase,
 * para que cambie de idioma con el interruptor. */
export type NewsCoverIssue =
  | { readonly kind: "rejected"; readonly code: NewsAttachmentIssueCode }
  | { readonly kind: "uploadFailed"; readonly failure: ApiRequestFailure };

export type NewsCoverField = {
  readonly cover: NewsCover;
  readonly issue: NewsCoverIssue | null;
  readonly isUploading: boolean;
  /** Lo que hay que mandar al guardar. */
  readonly change: NewsCoverChange;
  readonly choose: (file: File) => void;
  readonly remove: () => void;
};

/** Los tipos que el servidor acepta como portada (#591) y como imagen del
 * cuerpo (#603). */
export const NEWS_COVER_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

/** El tope de `NEWS_COVER_MAX_BYTES`, que es el de un adjunto. Se lee de
 * aquí porque `news-cover-uploads` es código de servidor. */
const COVER_MAX_BYTES = NEWS_ATTACHMENT_MAX_BYTES;

const COVER_ISSUES: NewsImageIssueCodes = {
  empty: "cover_empty",
  tooLarge: "cover_too_large",
  typeUnsupported: "cover_type_unsupported",
};

/** Lo que se comprueba antes de subir una imagen que el servidor reduce: la
 * portada o una del cuerpo (#603), cada una con sus códigos. Un archivo sin
 * tipo conocido sí se sube: quien decide es el servidor, mirando los bytes. */
export function checkNewsImageBeforeUpload(
  file: File,
  issues: NewsImageIssueCodes,
): NewsAttachmentIssueCode | null {
  if (file.size === 0) {
    return issues.empty;
  }
  if (file.size > COVER_MAX_BYTES) {
    return issues.tooLarge;
  }
  return file.type === "" || NEWS_COVER_TYPES.includes(file.type)
    ? null
    : issues.typeUnsupported;
}

function uploadFailureIssue(failure: ApiRequestFailure): NewsCoverIssue {
  const code = readAttachmentIssue(failure);
  return code === null
    ? { kind: "uploadFailed", failure }
    : { kind: "rejected", code };
}

function initialCover(currentUrl: string | null): NewsCover {
  return currentUrl === null
    ? { kind: "none" }
    : { kind: "current", url: currentUrl };
}

/** Dejar la que había es no tocarla; cualquier otra cosa la sustituye. */
function changeOf(cover: NewsCover, hadCover: boolean): NewsCoverChange {
  switch (cover.kind) {
    case "current":
      return { kind: "keep" };
    case "uploaded":
      return { kind: "replace", coverUploadId: cover.uploadId };
    case "none":
    case "uploading":
      return hadCover
        ? { kind: "replace", coverUploadId: null }
        : { kind: "keep" };
  }
}

/** Lo que se vuelve a ver si la nueva no vale. Mientras no se haya quitado,
 * la publicación que se edita sigue con la suya; la vista previa de una
 * subida anterior ya se soltó, así que esa no vuelve. */
function fallbackFor(cover: NewsCover, currentUrl: string | null): NewsCover {
  if (cover.kind === "none" || currentUrl === null) {
    return { kind: "none" };
  }
  return { kind: "current", url: currentUrl };
}

export function useNewsCover(currentUrl: string | null): NewsCoverField {
  const [cover, setCover] = useState<NewsCover>(() => initialCover(currentUrl));
  const [issue, setIssue] = useState<NewsCoverIssue | null>(null);
  // Cada elección tiene su número: la respuesta de una subida que ya se
  // quitó o se sustituyó no pisa lo que se ve.
  const latestChoice = useRef(0);
  const previewUrl = cover.kind === "uploaded" ? cover.previewUrl : null;

  useEffect(
    () => () => {
      if (previewUrl !== null) {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [previewUrl],
  );

  async function upload(
    choice: number,
    file: File,
    fallback: NewsCover,
  ): Promise<void> {
    const result = await uploadNewsCover(file);
    if (choice !== latestChoice.current) {
      return;
    }
    if (result.kind === "uploaded") {
      setCover({
        kind: "uploaded",
        uploadId: result.upload.id,
        previewUrl: URL.createObjectURL(file),
      });
      return;
    }
    setCover(fallback);
    setIssue(uploadFailureIssue(result));
  }

  function choose(file: File): void {
    const code = checkNewsImageBeforeUpload(file, COVER_ISSUES);
    if (code !== null) {
      setIssue({ kind: "rejected", code });
      return;
    }
    const fallback = fallbackFor(cover, currentUrl);
    latestChoice.current += 1;
    setIssue(null);
    setCover({ kind: "uploading" });
    void upload(latestChoice.current, file, fallback);
  }

  function remove(): void {
    latestChoice.current += 1;
    setIssue(null);
    setCover({ kind: "none" });
  }

  return {
    cover,
    issue,
    isUploading: cover.kind === "uploading",
    change: changeOf(cover, currentUrl !== null),
    choose,
    remove,
  };
}
