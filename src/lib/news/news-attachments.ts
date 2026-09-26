import { hasCapability } from "@/lib/auth/roles";
import { type DetectableFileType, detectFileType } from "@/lib/files/file-type";
import {
  type NewsAttachmentSummary,
  type NewsGateways,
  NewsForbiddenError,
  type NewsPost,
  NewsPostNotFoundError,
  findNewsReader,
  openNewsPost,
} from "./news-posts";

/**
 * Los adjuntos de una publicación (#328, RF-3 del PRD de E11), contados sin
 * Supabase delante.
 *
 * Sólo quien publicó sube y quita los de su publicación. Los sirve el
 * servidor, con una dirección firmada de vida corta, a quien puede abrir la
 * publicación y sólo mientras no esté retirada: el bucket es privado y nadie
 * lo lee con su propia sesión.
 *
 * El tipo sale de los bytes, y el nombre tiene que decir lo mismo: un
 * `acta.pdf` que por dentro es una imagen se rechaza, para que quien lo
 * descarga no se encuentre otra cosa de la que esperaba.
 */

/** 10 MB (decisión D3 del PRD), la misma cifra que el `check` de
 * `news_post_attachments.size_bytes` y el límite del bucket. */
export const NEWS_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Decisión D3; el trigger de `0029_news_posts.sql` es la última barrera. */
export const NEWS_ATTACHMENTS_MAX_PER_POST = 5;

/** Lo que cabe en un nombre de fichero en casi cualquier sistema. */
export const NEWS_ATTACHMENT_FILE_NAME_MAX_LENGTH = 255;

/** Las extensiones que admite cada tipo. La primera es la que lleva el
 * fichero guardado. */
const EXTENSIONS: Readonly<Record<DetectableFileType, readonly string[]>> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    "docx",
  ],
  "application/msword": ["doc"],
};

const CONTROL_CHARACTER = /\p{Cc}/u;
const PATH_SEPARATOR = /[/\\]/;

export const NEWS_ATTACHMENT_ISSUE_CODES = [
  "attachment_empty",
  "attachment_too_large",
  "attachment_type_unsupported",
  "attachment_type_mismatch",
  "attachment_name_invalid",
  "attachment_limit_reached",
] as const;

export type NewsAttachmentIssueCode =
  (typeof NEWS_ATTACHMENT_ISSUE_CODES)[number];

const ISSUE_MESSAGES: Readonly<Record<NewsAttachmentIssueCode, string>> = {
  attachment_empty: "El archivo está vacío.",
  attachment_too_large: "Cada adjunto puede pesar como mucho 10 MB.",
  attachment_type_unsupported:
    "Sólo valen PDF, imágenes JPEG, PNG o WebP, y documentos de Word.",
  attachment_type_mismatch:
    "La extensión del nombre no corresponde con el contenido del archivo.",
  attachment_name_invalid: `El nombre del archivo tiene que tener entre 1 y ${NEWS_ATTACHMENT_FILE_NAME_MAX_LENGTH} caracteres, sin barras ni caracteres de control.`,
  attachment_limit_reached: `Una publicación puede llevar como mucho ${NEWS_ATTACHMENTS_MAX_PER_POST} adjuntos.`,
};

export class NewsAttachmentValidationError extends Error {
  readonly code: NewsAttachmentIssueCode;

  constructor(code: NewsAttachmentIssueCode) {
    super(ISSUE_MESSAGES[code]);
    this.name = "NewsAttachmentValidationError";
    this.code = code;
  }
}

export class NewsAttachmentNotFoundError extends Error {
  constructor() {
    super("No existe ese adjunto.");
    this.name = "NewsAttachmentNotFoundError";
  }
}

/** Una fila nueva de `news_post_attachments`. */
export type NewNewsAttachment = {
  readonly postId: string;
  readonly clubId: string;
  readonly fileName: string;
  readonly contentType: DetectableFileType;
  readonly sizeBytes: number;
  readonly storagePath: string;
};

/** Lo que recibe quien pide un adjunto. Un fichero que ya no está en el
 * almacenamiento no es un error del servidor: la pantalla avisa y sigue. */
export type NewsAttachmentDownload =
  | {
      readonly status: "available";
      readonly fileName: string;
      readonly url: string;
    }
  | { readonly status: "unavailable"; readonly fileName: string };

export type NewsAttachmentGateways = NewsGateways & {
  readonly attachments: {
    /** Lanza `NewsAttachmentValidationError("attachment_limit_reached")`
     * si la base ya ve cinco. */
    insertAttachment(
      attachment: NewNewsAttachment,
    ): Promise<NewsAttachmentSummary>;
    findStoragePath(query: {
      readonly postId: string;
      readonly attachmentId: string;
    }): Promise<string | null>;
    deleteAttachment(attachmentId: string): Promise<void>;
  };
  readonly storage: {
    upload(
      storagePath: string,
      bytes: Uint8Array,
      type: DetectableFileType,
    ): Promise<void>;
    remove(storagePaths: readonly string[]): Promise<void>;
    /** Null cuando Storage no la pudo firmar porque el fichero ya no está. */
    signDownloadUrl(file: {
      readonly storagePath: string;
      readonly fileName: string;
    }): Promise<string | null>;
  };
  /** El nombre aleatorio del fichero nuevo. Se inyecta para que los tests
   * sepan qué ruta esperar. */
  readonly newFileId: () => string;
};

type AttachmentRequest = {
  readonly callerId: string;
  readonly postId: string;
  readonly attachmentId: string;
};

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

function validateFileName(rawName: string): string {
  const fileName = rawName.trim();
  const length = [...fileName].length;
  if (
    length === 0 ||
    length > NEWS_ATTACHMENT_FILE_NAME_MAX_LENGTH ||
    CONTROL_CHARACTER.test(fileName) ||
    PATH_SEPARATOR.test(fileName)
  ) {
    throw new NewsAttachmentValidationError("attachment_name_invalid");
  }
  return fileName;
}

/** El tipo del fichero, sacado de sus bytes y confirmado por su nombre. */
function validateFileBytes(
  bytes: Uint8Array,
  fileName: string,
): DetectableFileType {
  if (bytes.length === 0) {
    throw new NewsAttachmentValidationError("attachment_empty");
  }
  if (bytes.length > NEWS_ATTACHMENT_MAX_BYTES) {
    throw new NewsAttachmentValidationError("attachment_too_large");
  }
  const type = detectFileType(bytes);
  if (type === null) {
    throw new NewsAttachmentValidationError("attachment_type_unsupported");
  }
  if (!EXTENSIONS[type].includes(extensionOf(fileName))) {
    throw new NewsAttachmentValidationError("attachment_type_mismatch");
  }
  return type;
}

/** La publicación de quien llama, si puede publicar y es su autor. Una
 * publicación ajena responde como una que no existe, igual que al abrirla.
 * Una retirada también: sus adjuntos ya no se sirven a nadie, así que
 * subirle o quitarle uno no tiene sentido. */
async function findOwnPost(
  gateways: NewsAttachmentGateways,
  request: { readonly callerId: string; readonly postId: string },
): Promise<NewsPost> {
  const caller = await findNewsReader(gateways, request.callerId);
  if (!hasCapability(caller.role, "publishNewsAndDocuments")) {
    throw new NewsForbiddenError();
  }
  const post = await gateways.posts.findPost({
    clubId: caller.clubId,
    postId: request.postId,
  });
  if (
    post === null ||
    post.author.id !== request.callerId ||
    post.status === "withdrawn"
  ) {
    throw new NewsPostNotFoundError();
  }
  return post;
}

async function findStoragePath(
  gateways: NewsAttachmentGateways,
  request: AttachmentRequest,
): Promise<string> {
  const storagePath = await gateways.attachments.findStoragePath(request);
  if (storagePath === null) {
    throw new NewsAttachmentNotFoundError();
  }
  return storagePath;
}

/** Sube el fichero y sólo entonces apunta la fila. Si la fila no entra (la
 * base se cae, o otra subida simultánea llenó el cupo), se borra el fichero
 * para que no quede huérfano. */
async function storeAttachment(
  gateways: NewsAttachmentGateways,
  attachment: NewNewsAttachment,
  bytes: Uint8Array,
): Promise<NewsAttachmentSummary> {
  await gateways.storage.upload(
    attachment.storagePath,
    bytes,
    attachment.contentType,
  );
  try {
    return await gateways.attachments.insertAttachment(attachment);
  } catch (error) {
    await removeOrphanFile(gateways, attachment.storagePath);
    throw error;
  }
}

/** Si tampoco se puede borrar el fichero, queda registrado con su ruta para
 * limpiarlo a mano, y quien subió recibe el motivo de verdad (el límite, por
 * ejemplo) y no el de la limpieza. */
async function removeOrphanFile(
  gateways: NewsAttachmentGateways,
  storagePath: string,
): Promise<void> {
  try {
    await gateways.storage.remove([storagePath]);
  } catch (cleanupError) {
    console.error(
      `[news-attachments] quedó sin borrar el adjunto huérfano ${storagePath}`,
      cleanupError,
    );
  }
}

/** Adjunta un fichero a una publicación propia. Todo se comprueba antes de
 * subir nada: un rechazo no deja rastro en el almacenamiento. */
export async function attachNewsFile(
  gateways: NewsAttachmentGateways,
  request: {
    readonly callerId: string;
    readonly postId: string;
    readonly fileName: string;
    readonly bytes: Uint8Array;
  },
): Promise<NewsAttachmentSummary> {
  const post = await findOwnPost(gateways, request);
  const fileName = validateFileName(request.fileName);
  const contentType = validateFileBytes(request.bytes, fileName);
  if (post.attachments.length >= NEWS_ATTACHMENTS_MAX_PER_POST) {
    throw new NewsAttachmentValidationError("attachment_limit_reached");
  }
  const extension = EXTENSIONS[contentType][0];
  return storeAttachment(
    gateways,
    {
      postId: post.id,
      clubId: post.clubId,
      fileName,
      contentType,
      sizeBytes: request.bytes.length,
      storagePath: `${post.clubId}/${post.id}/${gateways.newFileId()}.${extension}`,
    },
    request.bytes,
  );
}

/** Quita la fila y después el fichero. En ese orden, un fallo a mitad deja
 * a lo sumo un fichero que nadie sirve, nunca un adjunto que apunta a nada. */
export async function removeNewsAttachment(
  gateways: NewsAttachmentGateways,
  request: AttachmentRequest,
): Promise<void> {
  await findOwnPost(gateways, request);
  const storagePath = await findStoragePath(gateways, request);
  await gateways.attachments.deleteAttachment(request.attachmentId);
  await gateways.storage.remove([storagePath]);
}

/**
 * Una dirección firmada del adjunto, para quien puede abrir la publicación.
 *
 * La audiencia la decide `openNewsPost`, así que todo lo que no le
 * corresponde responde igual que lo que no existe. Una publicación retirada
 * no sirve sus adjuntos a nadie, ni a quien la publicó (RF-3): la sigue
 * abriendo, pero retirar es dejar de repartir sus documentos.
 */
export async function serveNewsAttachment(
  gateways: NewsAttachmentGateways,
  request: AttachmentRequest,
): Promise<NewsAttachmentDownload> {
  const post = await openNewsPost(gateways, request);
  if (post.status === "withdrawn") {
    throw new NewsPostNotFoundError();
  }
  const attachment = post.attachments.find(
    (candidate) => candidate.id === request.attachmentId,
  );
  if (attachment === undefined) {
    throw new NewsAttachmentNotFoundError();
  }
  const storagePath = await findStoragePath(gateways, request);
  const url = await gateways.storage.signDownloadUrl({
    storagePath,
    fileName: attachment.fileName,
  });
  return url === null
    ? { status: "unavailable", fileName: attachment.fileName }
    : { status: "available", fileName: attachment.fileName, url };
}
