import type {
  NewNewsAttachment,
  NewsAttachmentGateways,
} from "@/lib/news/news-attachments";
import { NewsAttachmentValidationError } from "@/lib/news/news-attachments";
import type { NewsAttachmentSummary } from "@/lib/news/news-posts";
import { type FakeClubOptions, fakeClub } from "./news-club";

/**
 * Un club en memoria con almacenamiento, para los adjuntos (#328). El doble
 * cumple el contrato de los adaptadores: la base rechaza el sexto adjunto de
 * una publicación, y Storage no firma un fichero que ya no está.
 */

export const NEW_FILE_ID = "f5f5f5f5-0000-4000-8000-00000000000f";
export const SIGNED_URL_PREFIX = "https://storage.test/signed/";

/** Un id de adjunto con forma de uuid, como los de la base. */
export function attachmentIdFor(index: number): string {
  return `e4e4e4e4-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

export type StoredAttachment = NewNewsAttachment & { readonly id: string };

export type FakeAttachmentClubOptions = FakeClubOptions & {
  readonly attachments?: readonly StoredAttachment[];
  readonly storedFiles?: readonly string[];
  readonly failInsert?: boolean;
};

export type FakeAttachmentClub = {
  readonly gateways: NewsAttachmentGateways;
  readonly rows: StoredAttachment[];
  readonly files: Set<string>;
};

const MAX_ROWS_PER_POST = 5;

function toSummary(row: StoredAttachment): NewsAttachmentSummary {
  return {
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
  };
}

export function fakeAttachmentClub(
  options: FakeAttachmentClubOptions = {},
): FakeAttachmentClub {
  const news = fakeClub(options);
  const rows: StoredAttachment[] = [...(options.attachments ?? [])];
  const files = new Set(
    options.storedFiles ?? rows.map((row) => row.storagePath),
  );
  const gateways: NewsAttachmentGateways = {
    ...news.gateways,
    attachments: {
      insertAttachment: async (attachment) => {
        if (options.failInsert === true) {
          throw new Error("la base no responde");
        }
        const onPost = rows.filter((row) => row.postId === attachment.postId);
        if (onPost.length >= MAX_ROWS_PER_POST) {
          throw new NewsAttachmentValidationError("attachment_limit_reached");
        }
        const row = { ...attachment, id: attachmentIdFor(rows.length + 1) };
        rows.push(row);
        return toSummary(row);
      },
      findStoragePath: async ({ postId, attachmentId }) =>
        rows.find((row) => row.postId === postId && row.id === attachmentId)
          ?.storagePath ?? null,
      deleteAttachment: async (attachmentId) => {
        const index = rows.findIndex((row) => row.id === attachmentId);
        rows.splice(index, 1);
      },
    },
    storage: {
      upload: async (path) => {
        files.add(path);
      },
      remove: async (paths) => {
        for (const path of paths) {
          files.delete(path);
        }
      },
      signDownloadUrl: async ({ storagePath }) =>
        files.has(storagePath) ? `${SIGNED_URL_PREFIX}${storagePath}` : null,
    },
    newFileId: () => NEW_FILE_ID,
  };
  return { gateways, rows, files };
}
