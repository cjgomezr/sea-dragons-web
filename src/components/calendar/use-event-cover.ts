"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import type { EventCoverChange, FieldIssueCode } from "./event-form";
import { readEventIssue, uploadEventCover } from "./event-create-client";

/**
 * La imagen del diálogo de evento (#650, RF-9 del PRD de E24). Se sube en
 * cuanto se elige a `POST /api/v1/events/manage/uploads` (#644), como la
 * portada de noticias (`useNewsCover`), y guardar espera a que termine.
 *
 * Quitarla sólo cambia el formulario: si es una edición y no se guarda, el
 * evento conserva la suya. El tipo y el tamaño los decide el servidor, que
 * mira los bytes; su motivo se pinta traducido junto a la imagen.
 */

export type EventCover =
  | { readonly kind: "none" }
  /** La que ya tenía el evento que se edita. */
  | { readonly kind: "current"; readonly url: string }
  | { readonly kind: "uploading" }
  | {
      readonly kind: "uploaded";
      readonly coverUploadId: string;
      readonly previewUrl: string;
    };

/** Por qué la imagen elegida no valió. Se guarda el motivo y no la frase,
 * para que cambie de idioma con el interruptor. */
export type EventCoverIssue =
  | { readonly kind: "rejected"; readonly code: FieldIssueCode }
  | { readonly kind: "uploadFailed"; readonly failure: ApiRequestFailure };

export type EventCoverField = {
  readonly cover: EventCover;
  readonly issue: EventCoverIssue | null;
  readonly isUploading: boolean;
  /** Lo que hay que mandar al guardar. */
  readonly change: EventCoverChange;
  readonly choose: (file: File) => void;
  readonly remove: () => void;
};

/** Los tipos que el servidor acepta (#644). */
export const EVENT_COVER_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

function initialCover(currentUrl: string | null): EventCover {
  return currentUrl === null
    ? { kind: "none" }
    : { kind: "current", url: currentUrl };
}

/** Dejar la que había es no tocarla; cualquier otra cosa la sustituye. */
function changeOf(cover: EventCover, hadCover: boolean): EventCoverChange {
  switch (cover.kind) {
    case "current":
      return { kind: "keep" };
    case "uploaded":
      return { kind: "replace", coverUploadId: cover.coverUploadId };
    case "none":
    case "uploading":
      return hadCover
        ? { kind: "replace", coverUploadId: null }
        : { kind: "keep" };
  }
}

/** Lo que se vuelve a ver si la nueva no vale. Mientras no se haya quitado,
 * el evento que se edita sigue con la suya. */
function fallbackFor(cover: EventCover, currentUrl: string | null): EventCover {
  if (cover.kind === "none" || currentUrl === null) {
    return { kind: "none" };
  }
  return { kind: "current", url: currentUrl };
}

function issueOf(failure: ApiRequestFailure): EventCoverIssue {
  const code = readEventIssue(failure);
  return code === null
    ? { kind: "uploadFailed", failure }
    : { kind: "rejected", code };
}

export function useEventCover(currentUrl: string | null): EventCoverField {
  const [cover, setCover] = useState<EventCover>(() =>
    initialCover(currentUrl),
  );
  const [issue, setIssue] = useState<EventCoverIssue | null>(null);
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
    fallback: EventCover,
  ): Promise<void> {
    const result = await uploadEventCover(file);
    if (choice !== latestChoice.current) {
      return;
    }
    if (result.kind === "uploaded") {
      setCover({
        kind: "uploaded",
        coverUploadId: result.coverUploadId,
        previewUrl: URL.createObjectURL(file),
      });
      return;
    }
    setCover(fallback);
    setIssue(issueOf(result));
  }

  function choose(file: File): void {
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
