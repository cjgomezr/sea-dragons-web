import {
  NEWS_ATTACHMENTS_MAX_PER_POST,
  type NewsAttachmentGateways,
  NewsAttachmentNotFoundError,
  NewsAttachmentValidationError,
  type StoredNewsFile,
  storedExtensionOf,
  validateNewsAttachmentFile,
} from "./news-attachments";
import {
  type NewsAttachmentSummary,
  type NewsDraft,
  type NewsPost,
  type NewsPostDetail,
  findNewsPublisher,
  prepareNewsPost,
  toNewsPostDetail,
} from "./news-posts";

/**
 * Los adjuntos que se suben mientras se escribe una publicación (#330, RF-3
 * del PRD de E11), contados sin Supabase delante.
 *
 * El formulario sube cada archivo en cuanto se elige, para que el límite y el
 * motivo de un rechazo se vean al momento. Pero entonces la publicación
 * todavía no existe, y los adjuntos de #328 cuelgan de una. Así que la subida
 * espera en una carpeta de quien publica, y publicar la copia a la carpeta de
 * la publicación y la liga a ella. Si algo falla a mitad, la publicación se
 * borra y las subidas siguen donde estaban: no queda nada publicado a medias
 * (PRD, sección 7) y se puede reintentar con lo mismo.
 *
 * Un formulario abandonado deja sus subidas en esa carpeta. Las borra quien
 * las subió la siguiente vez que publica, pasado un día: así no se lleva por
 * delante lo que tenga a medias en otra pestaña.
 */

/** Un día: más de lo que nadie tarda en escribir una publicación, y poco
 * para que lo abandonado se acumule. */
export const STALE_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000;

const UPLOADS_FOLDER = "uploads";

type Publisher = { readonly clubId: string; readonly userId: string };

/** Una subida ya confirmada en el almacenamiento. */
type ResolvedUpload = StoredNewsFile & {
  readonly id: string;
  readonly storagePath: string;
};

function uploadsFolderOf(publisher: Publisher): string {
  return `${publisher.clubId}/${UPLOADS_FOLDER}/${publisher.userId}`;
}

/** El id de la subida es el nombre del fichero: sin extensión, porque el id
 * es lo único que el formulario devuelve al publicar. */
function uploadPathOf(publisher: Publisher, uploadId: string): string {
  return `${uploadsFolderOf(publisher)}/${uploadId}`;
}

async function findPublisher(
  gateways: NewsAttachmentGateways,
  callerId: string,
): Promise<Publisher> {
  const caller = await findNewsPublisher(gateways, callerId);
  return { clubId: caller.clubId, userId: callerId };
}

/** Sube un archivo antes de publicar. Todo se comprueba antes de subir: un
 * rechazo no deja rastro. */
export async function stageNewsUpload(
  gateways: NewsAttachmentGateways,
  request: {
    readonly callerId: string;
    readonly fileName: string;
    readonly bytes: Uint8Array;
  },
): Promise<NewsAttachmentSummary> {
  const publisher = await findPublisher(gateways, request.callerId);
  const { fileName, contentType } = validateNewsAttachmentFile(
    request.fileName,
    request.bytes,
  );
  const id = gateways.newFileId();
  await gateways.storage.upload({
    storagePath: uploadPathOf(publisher, id),
    bytes: request.bytes,
    contentType,
    fileName,
  });
  return { id, fileName, contentType, sizeBytes: request.bytes.length };
}

/** Quita una subida que todavía no se publicó. Sólo busca en la carpeta de
 * quien llama, así que la de otra persona responde como una que no existe. */
export async function discardNewsUpload(
  gateways: NewsAttachmentGateways,
  request: { readonly callerId: string; readonly uploadId: string },
): Promise<void> {
  const publisher = await findPublisher(gateways, request.callerId);
  const storagePath = uploadPathOf(publisher, request.uploadId);
  if ((await gateways.storage.describe(storagePath)) === null) {
    throw new NewsAttachmentNotFoundError();
  }
  await gateways.storage.remove([storagePath]);
}

async function resolveUploads(
  gateways: NewsAttachmentGateways,
  publisher: Publisher,
  uploadIds: readonly string[],
): Promise<readonly ResolvedUpload[]> {
  const uniqueIds = [...new Set(uploadIds)];
  if (uniqueIds.length > NEWS_ATTACHMENTS_MAX_PER_POST) {
    throw new NewsAttachmentValidationError("attachment_limit_reached");
  }
  return Promise.all(
    uniqueIds.map(async (id) => {
      const storagePath = uploadPathOf(publisher, id);
      const file = await gateways.storage.describe(storagePath);
      if (file === null) {
        throw new NewsAttachmentValidationError("attachment_upload_missing");
      }
      return { ...file, id, storagePath };
    }),
  );
}

/** Copia cada subida a la carpeta de la publicación y apunta su fila, en el
 * orden en que se eligieron. */
async function attachUploads(
  gateways: NewsAttachmentGateways,
  post: NewsPost,
  uploads: readonly ResolvedUpload[],
): Promise<readonly NewsAttachmentSummary[]> {
  const attachments: NewsAttachmentSummary[] = [];
  const copiedPaths: string[] = [];
  try {
    for (const upload of uploads) {
      const storagePath = `${post.clubId}/${post.id}/${upload.id}.${storedExtensionOf(upload.contentType)}`;
      await gateways.storage.copy(upload.storagePath, storagePath);
      copiedPaths.push(storagePath);
      attachments.push(
        await gateways.attachments.insertAttachment({
          postId: post.id,
          clubId: post.clubId,
          fileName: upload.fileName,
          contentType: upload.contentType,
          sizeBytes: upload.sizeBytes,
          storagePath,
        }),
      );
    }
  } catch (error) {
    await undoPublication(gateways, post.id, copiedPaths);
    throw error;
  }
  return attachments;
}

/** Borrar la publicación se lleva sus filas por la cascada; las copias hay
 * que borrarlas aparte. Si eso falla también, se registra y quien publicó
 * recibe el error de verdad, no el de la limpieza. */
async function undoPublication(
  gateways: NewsAttachmentGateways,
  postId: string,
  copiedPaths: readonly string[],
): Promise<void> {
  try {
    await gateways.posts.deletePost(postId);
    if (copiedPaths.length > 0) {
      await gateways.storage.remove(copiedPaths);
    }
  } catch (cleanupError) {
    console.error(
      `[news-uploads] no se pudo deshacer la publicación ${postId} a medias`,
      cleanupError,
    );
  }
}

/** Borra las subidas propias que se abandonaron hace más de un día. Lo ya
 * publicado sigue en pie aunque esto falle, así que un fallo se registra y
 * nada más. */
async function sweepStaleUploads(
  gateways: NewsAttachmentGateways,
  publisher: Publisher,
  now: Date,
): Promise<void> {
  try {
    const files = await gateways.storage.list(uploadsFolderOf(publisher));
    const oldest = now.getTime() - STALE_UPLOAD_AGE_MS;
    const stalePaths = files
      .filter((file) => Date.parse(file.createdAt) < oldest)
      .map((file) => file.storagePath);
    if (stalePaths.length > 0) {
      await gateways.storage.remove(stalePaths);
    }
  } catch (error) {
    console.error(
      `[news-uploads] no se pudieron limpiar las subidas abandonadas de ${uploadsFolderOf(publisher)}`,
      error,
    );
  }
}

/** Las subidas ya copiadas sobran. Si no se pueden borrar, las recoge la
 * limpieza de lo abandonado: ya no las nombra ninguna fila. */
async function removePublishedUploads(
  gateways: NewsAttachmentGateways,
  uploads: readonly ResolvedUpload[],
): Promise<void> {
  if (uploads.length === 0) {
    return;
  }
  try {
    await gateways.storage.remove(uploads.map((upload) => upload.storagePath));
  } catch (error) {
    console.error("[news-uploads] quedaron subidas ya publicadas", error);
  }
}

/** Publica con los adjuntos que se subieron mientras se escribía. Primero se
 * valida todo, subidas incluidas, y sólo entonces se escribe. */
export async function publishNewsPostWithUploads(
  gateways: NewsAttachmentGateways,
  request: {
    readonly callerId: string;
    readonly draft: NewsDraft;
    readonly uploadIds: readonly string[];
    readonly now: Date;
  },
): Promise<NewsPostDetail> {
  const newPost = await prepareNewsPost(gateways, request);
  const publisher = { clubId: newPost.clubId, userId: request.callerId };
  const uploads = await resolveUploads(gateways, publisher, request.uploadIds);
  const post = await gateways.posts.insertPost(newPost);
  const attachments = await attachUploads(gateways, post, uploads);
  await removePublishedUploads(gateways, uploads);
  await sweepStaleUploads(gateways, publisher, request.now);
  return { ...toNewsPostDetail(post), attachments };
}
