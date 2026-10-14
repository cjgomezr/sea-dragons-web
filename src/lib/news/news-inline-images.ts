import {
  type NewsAttachmentGateways,
  type NewsAttachmentIssueCode,
  NewsAttachmentValidationError,
} from "./news-attachments";
import {
  NEWS_COVER_MAX_BYTES,
  validateNewsImageFile,
} from "./news-cover-uploads";
import { findNewsInlineImageIds } from "./news-markdown";
import {
  type NewsAttachmentSummary,
  type NewsGateways,
  findNewsPublisher,
  findNewsReader,
  findReadableNewsPost,
} from "./news-posts";

/**
 * Las imágenes dentro del cuerpo de una noticia (#603, RF-14 del PRD de
 * E22), contadas sin Supabase delante.
 *
 * Se suben por el flujo de subidas de noticias con `kind=inline_image`, antes
 * de que exista la publicación, y se reducen en el servidor a un solo WebP de
 * 1600 px como la grande de la portada (D6). El cuerpo las nombra con una
 * dirección estable de la API (`news-inline-image-urls.ts`), que no cambia
 * al publicar: guardar la publicación sólo liga a ella las que su cuerpo
 * nombra, y quitar la línea de una al editar la borra.
 *
 * Quién la ve lo decide `serveNewsInlineImage`: sin publicación, sólo quien
 * la subió, que es quien la mira en la vista previa; con publicación, su
 * audiencia, y nadie si está retirada, como un adjunto (#328).
 */

/** El mismo tope que la portada y que el bucket. */
export const NEWS_INLINE_IMAGE_MAX_BYTES = NEWS_COVER_MAX_BYTES;

/** Un día, como las portadas y las subidas de adjuntos. */
export const STALE_INLINE_IMAGE_AGE_MS = 24 * 60 * 60 * 1000;

const INLINE_IMAGES_FOLDER = "inline-images";

const STORED_INLINE_IMAGE_TYPE = "image/webp";

const INLINE_IMAGE_ISSUES = {
  empty: "inline_image_empty",
  tooLarge: "inline_image_too_large",
  typeUnsupported: "inline_image_type_unsupported",
} as const satisfies Readonly<Record<string, NewsAttachmentIssueCode>>;

/** Una imagen subida, por su id y su club. */
export type NewsInlineImageRef = {
  readonly id: string;
  readonly clubId: string;
};

/** Una fila de `news_inline_images`. */
export type NewsInlineImage = NewsInlineImageRef & {
  readonly uploadedBy: string;
  readonly postId: string | null;
};

export type NewsInlineImagesGateway = {
  upload(file: {
    readonly storagePath: string;
    readonly bytes: Uint8Array;
  }): Promise<void>;
  removeFiles(storagePaths: readonly string[]): Promise<void>;
  /** Null cuando Storage no la pudo firmar porque el fichero ya no está. */
  signUrl(storagePath: string): Promise<string | null>;
  insertImage(
    image: NewsInlineImageRef & { readonly uploadedBy: string },
  ): Promise<void>;
  findImages(imageIds: readonly string[]): Promise<readonly NewsInlineImage[]>;
  findPostImages(postId: string): Promise<readonly NewsInlineImageRef[]>;
  linkImages(link: {
    readonly postId: string;
    readonly imageIds: readonly string[];
  }): Promise<void>;
  /** Las que subió esa persona antes de `createdBefore` y no liga ninguna
   * publicación. */
  findStaleImages(query: {
    readonly uploadedBy: string;
    readonly createdBefore: string;
  }): Promise<readonly NewsInlineImageRef[]>;
  deleteImage(imageId: string): Promise<void>;
};

/** La publicación tal como se guardó, que es lo que dice qué imágenes lleva. */
type SavedNewsPost = {
  readonly id: string;
  readonly clubId: string;
  readonly body: string;
};

export class NewsInlineImageNotFoundError extends Error {
  constructor() {
    super("No existe esa imagen.");
    this.name = "NewsInlineImageNotFoundError";
  }
}

export function newsInlineImagePathOf(image: NewsInlineImageRef): string {
  return `${image.clubId}/${INLINE_IMAGES_FOLDER}/${image.id}.webp`;
}

/** El nombre limpio de una imagen que vale, o el motivo por el que no. */
export function validateNewsInlineImageFile(
  rawName: string,
  bytes: Uint8Array,
): string {
  return validateNewsImageFile(rawName, bytes, INLINE_IMAGE_ISSUES);
}

/** Si la fila no entra, se borra el fichero para no dejarlo huérfano, y
 * quien subió recibe el error de verdad. */
async function storeInlineImage(
  gateways: NewsAttachmentGateways,
  image: NewsInlineImageRef & { readonly uploadedBy: string },
  bytes: Uint8Array,
): Promise<void> {
  const storagePath = newsInlineImagePathOf(image);
  await gateways.inlineImages.upload({ storagePath, bytes });
  try {
    await gateways.inlineImages.insertImage(image);
  } catch (error) {
    await removeFilesLogged(gateways.inlineImages, [storagePath]);
    throw error;
  }
}

/** Quien llama ya tiene su respuesta; un fichero que no se pudo borrar se
 * registra con su ruta para limpiarlo a mano. */
async function removeFilesLogged(
  inlineImages: NewsInlineImagesGateway,
  storagePaths: readonly string[],
): Promise<void> {
  try {
    await inlineImages.removeFiles(storagePaths);
  } catch (error) {
    console.error(
      `[news-inline-images] quedó sin borrar ${storagePaths.join(", ")}`,
      error,
    );
  }
}

/** Sube una imagen del cuerpo antes de publicar o al editar. Todo se
 * comprueba antes de subir: un rechazo no deja rastro. */
export async function stageNewsInlineImage(
  gateways: NewsAttachmentGateways,
  request: {
    readonly callerId: string;
    readonly fileName: string;
    readonly bytes: Uint8Array;
  },
): Promise<NewsAttachmentSummary> {
  const caller = await findNewsPublisher(gateways, request.callerId);
  const fileName = validateNewsInlineImageFile(request.fileName, request.bytes);
  const shrunk = await gateways.images.shrinkInlineImage(request.bytes);
  if (shrunk.kind === "undecodable") {
    throw new NewsAttachmentValidationError(
      INLINE_IMAGE_ISSUES.typeUnsupported,
    );
  }
  const id = gateways.newFileId();
  await storeInlineImage(
    gateways,
    { id, clubId: caller.clubId, uploadedBy: request.callerId },
    shrunk.image,
  );
  return {
    id,
    fileName,
    contentType: STORED_INLINE_IMAGE_TYPE,
    sizeBytes: shrunk.image.length,
  };
}

function isLinkableBy(
  image: NewsInlineImage,
  owner: { readonly callerId: string; readonly clubId: string },
): boolean {
  return (
    image.clubId === owner.clubId &&
    image.uploadedBy === owner.callerId &&
    image.postId === null
  );
}

/** Liga a la publicación las imágenes que su cuerpo nombra y aún no son de
 * ninguna. Sólo las que subió quien guarda: una dirección copiada de otra
 * publicación, o de otra persona, se queda como estaba. */
export async function linkNewsInlineImages(
  gateways: Pick<NewsGateways, "inlineImages">,
  request: { readonly callerId: string; readonly post: SavedNewsPost },
): Promise<void> {
  const { post } = request;
  const named = findNewsInlineImageIds(post.body);
  if (named.length === 0) {
    return;
  }
  const images = await gateways.inlineImages.findImages(named);
  const imageIds = images
    .filter((image) =>
      isLinkableBy(image, { callerId: request.callerId, clubId: post.clubId }),
    )
    .map((image) => image.id);
  if (imageIds.length > 0) {
    await gateways.inlineImages.linkImages({ postId: post.id, imageIds });
  }
}

/** Quita la fila y después el fichero, como un adjunto: un fallo a mitad
 * deja a lo sumo un fichero que nadie sirve. */
async function discardInlineImage(
  inlineImages: NewsInlineImagesGateway,
  image: NewsInlineImageRef,
): Promise<void> {
  try {
    await inlineImages.deleteImage(image.id);
    await inlineImages.removeFiles([newsInlineImagePathOf(image)]);
  } catch (error) {
    console.error(
      `[news-inline-images] quedó sin borrar la imagen ${newsInlineImagePathOf(image)}`,
      error,
    );
  }
}

/** Las imágenes de la publicación que su cuerpo ya no nombra dejan de
 * servirse. La edición ya se guardó, así que un fallo se registra y no se
 * lanza. */
export async function discardUnusedNewsInlineImages(
  gateways: Pick<NewsGateways, "inlineImages">,
  post: SavedNewsPost,
): Promise<void> {
  const named = new Set(findNewsInlineImageIds(post.body));
  try {
    const linked = await gateways.inlineImages.findPostImages(post.id);
    for (const image of linked.filter(
      (candidate) => !named.has(candidate.id),
    )) {
      await discardInlineImage(gateways.inlineImages, image);
    }
  } catch (error) {
    console.error(
      `[news-inline-images] no se pudieron buscar las imágenes de ${post.id}`,
      error,
    );
  }
}

/** Borra las imágenes propias que se subieron hace más de un día y ninguna
 * publicación liga. */
export async function sweepStaleNewsInlineImages(
  gateways: Pick<NewsGateways, "inlineImages">,
  request: { readonly uploadedBy: string; readonly now: Date },
): Promise<void> {
  try {
    const stale = await gateways.inlineImages.findStaleImages({
      uploadedBy: request.uploadedBy,
      createdBefore: new Date(
        request.now.getTime() - STALE_INLINE_IMAGE_AGE_MS,
      ).toISOString(),
    });
    for (const image of stale) {
      await discardInlineImage(gateways.inlineImages, image);
    }
  } catch (error) {
    console.error(
      `[news-inline-images] no se pudieron buscar las imágenes abandonadas de ${request.uploadedBy}`,
      error,
    );
  }
}

/** Si quien llama puede ver la imagen: sin publicación, sólo quien la subió;
 * con ella, su audiencia mientras no esté retirada. */
async function canSeeInlineImage(
  gateways: NewsGateways,
  request: { readonly callerId: string; readonly image: NewsInlineImage },
): Promise<boolean> {
  const { callerId, image } = request;
  if (image.postId === null) {
    return image.uploadedBy === callerId;
  }
  const post = await findReadableNewsPost(gateways, {
    callerId,
    postId: image.postId,
  });
  return post !== null && post.status !== "withdrawn";
}

/**
 * Una dirección firmada de la imagen, para quien puede verla.
 *
 * Todo lo que no le corresponde responde igual que lo que no existe, como un
 * adjunto: la de otro club, la de una publicación ajena o retirada, y la que
 * otra persona aún no publicó.
 */
export async function serveNewsInlineImage(
  gateways: NewsGateways,
  request: { readonly callerId: string; readonly imageId: string },
): Promise<string> {
  const caller = await findNewsReader(gateways, request.callerId);
  const [image] = await gateways.inlineImages.findImages([request.imageId]);
  if (
    image === undefined ||
    image.clubId !== caller.clubId ||
    !(await canSeeInlineImage(gateways, { callerId: request.callerId, image }))
  ) {
    throw new NewsInlineImageNotFoundError();
  }
  const url = await gateways.inlineImages.signUrl(newsInlineImagePathOf(image));
  if (url === null) {
    throw new NewsInlineImageNotFoundError();
  }
  return url;
}
