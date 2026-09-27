"use client";

import { useRef, useState } from "react";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import {
  NEWS_ATTACHMENT_MAX_BYTES,
  NEWS_ATTACHMENTS_MAX_PER_POST,
  type NewsAttachmentIssueCode,
} from "@/lib/news/news-attachments";
import type { NewsAttachmentSummary } from "@/lib/news/news-posts";
import {
  readAttachmentIssue,
  removeNewsUpload,
  uploadNewsAttachment,
} from "./news-publish-client";

/**
 * Los adjuntos del formulario de publicar (#330). Cada archivo se sube en
 * cuanto se elige, así que el límite y el motivo de un rechazo se ven al
 * momento, y un archivo que no vale no se lleva por delante los demás.
 *
 * El tamaño y el número se comprueban aquí antes de subir: no tiene sentido
 * mandar 40 MB para que el servidor diga que no. El tipo lo decide el
 * servidor, que es quien mira los bytes.
 */

export type AttachmentEntry =
  | {
      readonly kind: "uploading";
      readonly key: string;
      readonly fileName: string;
    }
  | {
      readonly kind: "uploaded";
      readonly key: string;
      readonly upload: NewsAttachmentSummary;
      readonly isRemoving: boolean;
    };

/** Lo que salió mal con un archivo. Se guarda el motivo y no la frase, para
 * que cambie de idioma con el interruptor. */
export type AttachmentNotice =
  | {
      readonly kind: "rejected";
      readonly fileName: string;
      readonly code: NewsAttachmentIssueCode;
    }
  | {
      readonly kind: "uploadFailed" | "removeFailed";
      readonly fileName: string;
      readonly failure: ApiRequestFailure;
    };

export type NewsAttachments = {
  readonly entries: readonly AttachmentEntry[];
  readonly notices: readonly AttachmentNotice[];
  readonly isUploading: boolean;
  /** Los ids de lo ya subido, en el orden en que se eligió. */
  readonly uploadIds: readonly string[];
  readonly addFiles: (files: readonly File[]) => void;
  readonly remove: (key: string) => void;
};

/** Por qué un archivo no llega ni a subirse, o null si se puede subir. */
function checkBeforeUpload(file: File): NewsAttachmentIssueCode | null {
  if (file.size === 0) {
    return "attachment_empty";
  }
  return file.size > NEWS_ATTACHMENT_MAX_BYTES ? "attachment_too_large" : null;
}

function uploadFailureNotice(
  fileName: string,
  failure: ApiRequestFailure,
): AttachmentNotice {
  const code = readAttachmentIssue(failure);
  return code === null
    ? { kind: "uploadFailed", fileName, failure }
    : { kind: "rejected", fileName, code };
}

export function useNewsAttachments(): NewsAttachments {
  const [entries, setEntries] = useState<readonly AttachmentEntry[]>([]);
  const [notices, setNotices] = useState<readonly AttachmentNotice[]>([]);
  // Cada archivo elegido recibe una clave propia: dos con el mismo nombre
  // son dos adjuntos.
  const nextKey = useRef(0);

  function replaceEntry(key: string, entry: AttachmentEntry | null): void {
    setEntries((current) =>
      current.flatMap((candidate) => {
        if (candidate.key !== key) {
          return [candidate];
        }
        return entry === null ? [] : [entry];
      }),
    );
  }

  async function upload(key: string, file: File): Promise<void> {
    const result = await uploadNewsAttachment(file);
    if (result.kind === "uploaded") {
      replaceEntry(key, {
        kind: "uploaded",
        key,
        upload: result.upload,
        isRemoving: false,
      });
      return;
    }
    replaceEntry(key, null);
    setNotices((current) => [
      ...current,
      uploadFailureNotice(file.name, result),
    ]);
  }

  function addFiles(files: readonly File[]): void {
    const freeSlots = NEWS_ATTACHMENTS_MAX_PER_POST - entries.length;
    const rejected: AttachmentNotice[] = [];
    const started: AttachmentEntry[] = [];
    files.forEach((file, index) => {
      const code =
        index >= freeSlots
          ? "attachment_limit_reached"
          : checkBeforeUpload(file);
      if (code !== null) {
        rejected.push({ kind: "rejected", fileName: file.name, code });
        return;
      }
      nextKey.current += 1;
      const key = `adjunto-${nextKey.current}`;
      started.push({ kind: "uploading", key, fileName: file.name });
      void upload(key, file);
    });
    setNotices(rejected);
    setEntries((current) => [...current, ...started]);
  }

  async function removeUploaded(
    entry: Extract<AttachmentEntry, { kind: "uploaded" }>,
  ): Promise<void> {
    replaceEntry(entry.key, { ...entry, isRemoving: true });
    const result = await removeNewsUpload(entry.upload.id);
    if (result.kind === "removed") {
      replaceEntry(entry.key, null);
      return;
    }
    replaceEntry(entry.key, { ...entry, isRemoving: false });
    setNotices([
      {
        kind: "removeFailed",
        fileName: entry.upload.fileName,
        failure: result,
      },
    ]);
  }

  function remove(key: string): void {
    const entry = entries.find((candidate) => candidate.key === key);
    if (entry?.kind !== "uploaded" || entry.isRemoving) {
      return;
    }
    setNotices([]);
    void removeUploaded(entry);
  }

  return {
    entries,
    notices,
    isUploading: entries.some((entry) => entry.kind === "uploading"),
    uploadIds: entries.flatMap((entry) =>
      entry.kind === "uploaded" ? [entry.upload.id] : [],
    ),
    addFiles,
    remove,
  };
}
