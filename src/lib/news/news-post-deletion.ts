import { recordAuditEvent } from "@/lib/audit/audit-log";
import { newsCoverPathsOf } from "./news-covers";
import { newsInlineImagePathOf } from "./news-inline-images";
import { type PostRequest, findManagedPost } from "./news-management";
import {
  type NewsGateways,
  type NewsPostFiles,
  NewsPostNotFoundError,
} from "./news-posts";

/**
 * Borrar para siempre una publicación ya retirada (#958), como borrar un
 * ciclo de entrenamiento (#935): sólo lo que ya no está en uso. Una publicada
 * se retira antes. Puede quien puede retirarla: quien la publicó o un Admin.
 *
 * Las filas se van en una transacción de la base, que vuelve a mirar el
 * estado con la publicación bloqueada. Los ficheros se borran después, desde
 * el servidor: Supabase no deja borrar objetos desde SQL. Un fichero que no
 * se pudo borrar no deshace el borrado: queda en el log.
 */

/** En la bitácora la entidad es la publicación: "sobre cuál". */
const AUDITED_ENTITY_TYPE = "news_post";

export class NewsPostIsPublishedError extends Error {
  constructor() {
    super("Withdraw it first.");
    this.name = "NewsPostIsPublishedError";
  }
}

/** Lo que queda por limpiar en el almacenamiento. */
export type DeletedNewsPost = {
  readonly storagePaths: readonly string[];
};

/** Lo único que necesita la limpieza: borrar ficheros del bucket. */
export type NewsFilesRemover = {
  removeFiles(storagePaths: readonly string[]): Promise<void>;
};

function storagePathsOf(clubId: string, files: NewsPostFiles): string[] {
  const coverPaths =
    files.coverUploadId === null
      ? []
      : Object.values(newsCoverPathsOf({ id: files.coverUploadId, clubId }));
  return [
    ...files.attachmentPaths,
    ...coverPaths,
    ...files.inlineImageIds.map((id) => newsInlineImagePathOf({ id, clubId })),
  ];
}

/** Mirar el estado aquí da el 409 sin tocar la base; la función lo vuelve a
 * mirar con la fila bloqueada, por si alguien la volvió a publicar entre
 * medias. La bitácora lleva el título: después no queda publicación que lo
 * diga. */
export async function deleteNewsPost(
  gateways: NewsGateways,
  request: PostRequest,
): Promise<DeletedNewsPost> {
  const { actor, post } = await findManagedPost(gateways, request);
  if (post.status === "published") {
    throw new NewsPostIsPublishedError();
  }
  const deletion = await gateways.posts.deleteWithdrawnPost({
    clubId: actor.clubId,
    postId: post.id,
  });
  if (deletion.kind === "missing") {
    throw new NewsPostNotFoundError();
  }
  if (deletion.kind === "published") {
    throw new NewsPostIsPublishedError();
  }
  await recordAuditEvent(gateways.audit, {
    actor,
    clubId: actor.clubId,
    action: "news_post.deleted",
    entityType: AUDITED_ENTITY_TYPE,
    entityId: post.id,
    result: "success",
    metadata: { title: deletion.title },
  });
  return { storagePaths: storagePathsOf(actor.clubId, deletion.files) };
}

/** Un fichero cada vez, para que uno que falla no se lleve a los demás. El
 * que no se pudo borrar queda huérfano en el bucket y en el log, como el
 * adjunto huérfano de `news-attachments.ts`. */
export async function removeDeletedNewsPostFiles(
  remover: NewsFilesRemover,
  storagePaths: readonly string[],
): Promise<void> {
  for (const storagePath of storagePaths) {
    try {
      await remover.removeFiles([storagePath]);
    } catch (error) {
      console.error(
        `[news-post-deletion] quedó sin borrar el fichero ${storagePath} de una publicación borrada`,
        error,
      );
    }
  }
}
