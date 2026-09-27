import type { AccountStatus } from "@/lib/auth/account-status";
import type {
  NewNewsAttachment,
  NewsAttachmentGateways,
  StoredNewsFile,
} from "@/lib/news/news-attachments";
import { NewsAttachmentValidationError } from "@/lib/news/news-attachments";
import type {
  NewsAudience,
  NewsAttachmentSummary,
} from "@/lib/news/news-posts";
import type { NewsPublishGateways } from "@/lib/news/news-publication-notice";
import type {
  NotificationBroadcastWriter,
  NotificationInsert,
} from "@/lib/notifications/notify-member";
import {
  CLUB_ID,
  type FakeClub,
  type FakeClubOptions,
  fakeClub,
} from "./news-club";

/**
 * Un club en memoria con almacenamiento, para los adjuntos (#328, #330). El
 * doble cumple el contrato de los adaptadores: la base rechaza el sexto
 * adjunto de una publicación, y Storage no firma un fichero que ya no está.
 */

export const NEW_FILE_ID = "f5f5f5f5-0000-4000-8000-00000000000f";
export const SIGNED_URL_PREFIX = "https://storage.test/signed/";

/** Un id de adjunto con forma de uuid, como los de la base. */
export function attachmentIdFor(index: number): string {
  return `e4e4e4e4-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/** Un id de subida previa con forma de uuid, como los que reparte el
 * servidor. */
export function uploadIdFor(index: number): string {
  return `a7a7a7a7-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

export type StoredAttachment = NewNewsAttachment & { readonly id: string };

/** Un fichero del almacenamiento, con lo que Storage sabe de él. */
export type FakeStoredFile = StoredNewsFile & { readonly storagePath: string };

export type FakeAttachmentClubOptions = FakeClubOptions & {
  /** Los socios del club con el estado de su cuenta, para los avisos (#332). */
  readonly clubMembers?: Readonly<Record<string, AccountStatus>>;
  /** Quién está en cada grupo. */
  readonly groupMembers?: Readonly<Record<string, readonly string[]>>;
  readonly failAudience?: boolean;
  /** Los socios cuyo aviso no se guarda: tumba también la escritura en lote. */
  readonly failNoticeFor?: readonly string[];
  readonly attachments?: readonly StoredAttachment[];
  readonly storedFiles?: readonly FakeStoredFile[];
  readonly failInsert?: boolean;
  readonly failRemove?: boolean;
  readonly failList?: boolean;
};

export type FakeAttachmentClub = {
  readonly gateways: NewsPublishGateways;
  /** Los avisos guardados, en el orden en que se escribieron. */
  readonly notices: NotificationInsert[];
  readonly rows: StoredAttachment[];
  readonly deletedPostIds: string[];
  readonly inserted: FakeClub["inserted"];
  readonly feedQueries: FakeClub["feedQueries"];
  readonly posts: FakeClub["posts"];
  readonly edits: FakeClub["edits"];
  readonly audited: FakeClub["audited"];
  /** Las rutas que hay en el almacenamiento. */
  readonly files: Set<string>;
  readonly fileInfo: Map<string, StoredNewsFile>;
};

const MAX_ROWS_PER_POST = 5;
const STORED_AT = "2026-09-27T10:00:00.000Z";

function toSummary(row: StoredAttachment): NewsAttachmentSummary {
  return {
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
  };
}

function fileOfRow(row: StoredAttachment): FakeStoredFile {
  return {
    storagePath: row.storagePath,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    createdAt: STORED_AT,
  };
}

function createFakeStorage(
  options: FakeAttachmentClubOptions,
  files: Set<string>,
  fileInfo: Map<string, StoredNewsFile>,
): NewsAttachmentGateways["storage"] {
  const store = (storagePath: string, file: StoredNewsFile): void => {
    files.add(storagePath);
    fileInfo.set(storagePath, file);
  };
  return {
    upload: async ({ storagePath, bytes, contentType, fileName }) => {
      store(storagePath, {
        fileName,
        contentType,
        sizeBytes: bytes.length,
        createdAt: STORED_AT,
      });
    },
    describe: async (storagePath) => fileInfo.get(storagePath) ?? null,
    copy: async (fromPath, toPath) => {
      const file = fileInfo.get(fromPath);
      if (file === undefined) {
        throw new Error(`no existe ${fromPath}`);
      }
      store(toPath, file);
    },
    list: async (folder) => {
      if (options.failList === true) {
        throw new Error("Storage no responde");
      }
      return [...fileInfo.entries()]
        .filter(([path]) => path.startsWith(`${folder}/`))
        .map(([storagePath, file]) => ({
          storagePath,
          createdAt: file.createdAt,
        }));
    },
    remove: async (paths) => {
      if (options.failRemove === true) {
        throw new Error("Storage no responde");
      }
      for (const path of paths) {
        files.delete(path);
        fileInfo.delete(path);
      }
    },
    signDownloadUrl: async ({ storagePath }) =>
      files.has(storagePath) ? `${SIGNED_URL_PREFIX}${storagePath}` : null,
  };
}

/** La audiencia como la resuelve la base: todo el club, o quien esté en
 * alguno de los grupos. Sin quitar repetidos, a propósito: de eso se encarga
 * la puerta de avisos. */
function audienceOf(
  options: FakeAttachmentClubOptions,
  audience: NewsAudience,
): readonly string[] {
  if (audience.kind === "club") {
    return Object.keys(options.clubMembers ?? {});
  }
  return audience.groupIds.flatMap((id) => options.groupMembers?.[id] ?? []);
}

function createFakeNotices(
  options: FakeAttachmentClubOptions,
  notices: NotificationInsert[],
): NotificationBroadcastWriter {
  const failsFor = (row: NotificationInsert): boolean =>
    options.failNoticeFor?.includes(row.userId) === true;
  return {
    findRecipients: async (userIds) =>
      new Map(
        userIds.flatMap((id) => {
          const accountStatus = options.clubMembers?.[id];
          return accountStatus === undefined
            ? []
            : [[id, { clubId: CLUB_ID, accountStatus }] as const];
        }),
      ),
    insertNotifications: async (rows) => {
      if (rows.some(failsFor)) {
        throw new Error("la escritura en lote se cayó");
      }
      notices.push(...rows);
    },
    insertNotification: async (row) => {
      if (failsFor(row)) {
        throw new Error(`no se guardó el aviso de ${row.userId}`);
      }
      notices.push(row);
    },
    pruneNotificationsOf: async () => new Map(),
    runAfterResponse: () => {},
  };
}

export function fakeAttachmentClub(
  options: FakeAttachmentClubOptions = {},
): FakeAttachmentClub {
  const news = fakeClub(options);
  const rows: StoredAttachment[] = [...(options.attachments ?? [])];
  const storedFiles = options.storedFiles ?? rows.map(fileOfRow);
  const fileInfo = new Map<string, StoredNewsFile>(
    storedFiles.map(({ storagePath, ...file }) => [storagePath, file]),
  );
  const files = new Set(fileInfo.keys());
  const notices: NotificationInsert[] = [];
  const gateways: NewsPublishGateways = {
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
    storage: createFakeStorage(options, files, fileInfo),
    newFileId: () => NEW_FILE_ID,
    newsAudience: {
      findAudienceMemberIds: async ({ audience }) => {
        if (options.failAudience === true) {
          throw new Error("la audiencia no se pudo leer");
        }
        return audienceOf(options, audience);
      },
    },
    notifications: createFakeNotices(options, notices),
  };
  return {
    gateways,
    notices,
    rows,
    files,
    fileInfo,
    inserted: news.inserted,
    feedQueries: news.feedQueries,
    deletedPostIds: news.deletedPostIds,
    posts: news.posts,
    edits: news.edits,
    audited: news.audited,
  };
}
