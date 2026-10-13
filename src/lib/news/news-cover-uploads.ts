import { detectFileType } from "@/lib/files/file-type";
import {
  NEWS_ATTACHMENT_MAX_BYTES,
  type NewsAttachmentGateways,
  NewsAttachmentValidationError,
  validateNewsAttachmentName,
} from "./news-attachments";
import {
  type NewsCoverRef,
  type NewsCoverUpload,
  newsCoverPathsOf,
} from "./news-covers";
import {
  type NewsAttachmentSummary,
  type NewsGateways,
  findNewsPublisher,
} from "./news-posts";

/**
 * Subir la portada y comprobarla al publicar o editar (#591, RF-2 del PRD de
 * E22). Va por el mismo flujo que los adjuntos que se suben antes de publicar
 * (#330), con `kind=cover`, pero no se queda en la carpeta de subidas: se
 * reduce en el momento, se guardan sus dos versiones y el original no se
 * guarda nunca (decisión D6).
 */

/** El mismo tope que un adjunto (decisión D3 de E11) y que el bucket. */
export const NEWS_COVER_MAX_BYTES = NEWS_ATTACHMENT_MAX_BYTES;

const COVER_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Las dos versiones son WebP; lo que se devuelve describe la grande. */
const STORED_COVER_TYPE = "image/webp";

/** El nombre limpio de una portada que vale, o el motivo por el que no. El
 * nombre no tiene que coincidir con el tipo: la portada se vuelve a
 * codificar, así que lo que llegue dentro es lo único que cuenta. */
export function validateNewsCoverFile(
  rawName: string,
  bytes: Uint8Array,
): string {
  const fileName = validateNewsAttachmentName(rawName);
  if (bytes.length === 0) {
    throw new NewsAttachmentValidationError("cover_empty");
  }
  if (bytes.length > NEWS_COVER_MAX_BYTES) {
    throw new NewsAttachmentValidationError("cover_too_large");
  }
  const type = detectFileType(bytes);
  if (type === null || !COVER_TYPES.has(type)) {
    throw new NewsAttachmentValidationError("cover_type_unsupported");
  }
  return fileName;
}

/** Si la fila no entra, se borran los ficheros para no dejarlos huérfanos, y
 * quien subió recibe el error de verdad. */
async function storeCover(
  gateways: NewsAttachmentGateways,
  cover: NewsCoverRef & { readonly uploadedBy: string },
  versions: { readonly thumbnail: Uint8Array; readonly large: Uint8Array },
): Promise<void> {
  const paths = newsCoverPathsOf(cover);
  const uploaded: string[] = [];
  try {
    for (const [storagePath, bytes] of [
      [paths.thumbnail, versions.thumbnail],
      [paths.large, versions.large],
    ] as const) {
      await gateways.covers.upload({ storagePath, bytes });
      uploaded.push(storagePath);
    }
    await gateways.covers.insertCover(cover);
  } catch (error) {
    await removeOrphanCoverFiles(gateways, uploaded);
    throw error;
  }
}

async function removeOrphanCoverFiles(
  gateways: NewsAttachmentGateways,
  storagePaths: readonly string[],
): Promise<void> {
  if (storagePaths.length === 0) {
    return;
  }
  try {
    await gateways.covers.removeFiles(storagePaths);
  } catch (cleanupError) {
    console.error(
      `[news-covers] quedó sin borrar la portada huérfana ${storagePaths.join(", ")}`,
      cleanupError,
    );
  }
}

/** Sube una portada antes de publicar o al editar. Todo se comprueba antes
 * de subir: un rechazo no deja rastro. */
export async function stageNewsCover(
  gateways: NewsAttachmentGateways,
  request: {
    readonly callerId: string;
    readonly fileName: string;
    readonly bytes: Uint8Array;
  },
): Promise<NewsAttachmentSummary> {
  const caller = await findNewsPublisher(gateways, request.callerId);
  const fileName = validateNewsCoverFile(request.fileName, request.bytes);
  const shrunk = await gateways.images.shrinkCover(request.bytes);
  if (shrunk.kind === "undecodable") {
    throw new NewsAttachmentValidationError("cover_type_unsupported");
  }
  const id = gateways.newFileId();
  await storeCover(
    gateways,
    { id, clubId: caller.clubId, uploadedBy: request.callerId },
    shrunk,
  );
  return {
    id,
    fileName,
    contentType: STORED_COVER_TYPE,
    sizeBytes: shrunk.large.length,
  };
}

function isUsableBy(
  cover: NewsCoverUpload | null,
  owner: { readonly callerId: string; readonly clubId: string },
): cover is NewsCoverUpload {
  return (
    cover !== null &&
    cover.clubId === owner.clubId &&
    cover.uploadedBy === owner.callerId &&
    cover.postId === null
  );
}

/** La portada que quien publica o edita quiere poner. Sólo vale una suya,
 * de su club y que no use ya otra publicación; las demás responden como una
 * que no está, igual que una subida de adjunto ajena. */
export async function resolveNewsCoverUpload(
  gateways: Pick<NewsGateways, "covers">,
  request: {
    readonly callerId: string;
    readonly clubId: string;
    readonly coverUploadId: string;
  },
): Promise<NewsCoverRef> {
  const cover = await gateways.covers.findCover(request.coverUploadId);
  if (!isUsableBy(cover, request)) {
    throw new NewsAttachmentValidationError("cover_upload_missing");
  }
  return { id: cover.id, clubId: cover.clubId };
}
