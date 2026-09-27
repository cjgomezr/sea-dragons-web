import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import { DETECTABLE_FILE_TYPES } from "@/lib/files/file-type";
import {
  type NewsAttachmentGateways,
  NewsAttachmentValidationError,
  type StoredNewsFile,
} from "./news-attachments";
import type { NewsAttachmentSummary } from "./news-posts";
import { createNewsGateways } from "./supabase-news-gateways";

/**
 * Los adjuntos de noticias contra Supabase (#328).
 *
 * Todo va por la llave de servicio, como el logo del club: el bucket de
 * `0030_news_attachments.sql` no tiene ninguna policy, así que ningún miembro
 * lo toca con su sesión. Quién sube, quita o recibe la dirección lo decidió
 * ya el dominio.
 */

export const NEWS_ATTACHMENTS_BUCKET = "news-attachments";

/** Cinco minutos: lo que tarda en empezar una descarga que se pidió al
 * pulsar, y poco para que una dirección reenviada a alguien de fuera de la
 * audiencia le sirva de algo. La pantalla pide otra en cada pulsación. */
export const NEWS_ATTACHMENT_URL_LIFETIME_SECONDS = 5 * 60;

const ATTACHMENTS_TABLE = "news_post_attachments";

/** El mensaje con el que el trigger de `0029_news_posts.sql` rechaza el
 * sexto adjunto. */
const MAX_PER_POST_VIOLATION = "news_post_attachments_max_per_post";

/** Dónde guarda Storage el nombre con el que se subió el fichero. */
const FILE_NAME_METADATA_KEY = "fileName";

/** Las subidas abandonadas de una persona son pocas; una página basta. */
const LIST_PAGE_SIZE = 100;

type Environment = Readonly<Record<string, string | undefined>>;

const storedFileSchema = z.object({
  size: z.number().int().nonnegative(),
  contentType: z.enum(DETECTABLE_FILE_TYPES),
  createdAt: z.string(),
  metadata: z.object({ [FILE_NAME_METADATA_KEY]: z.string() }),
});

/** Storage responde a un fichero que no está con este código. */
const NOT_FOUND_CODE = "NoSuchKey";

const attachmentRowSchema = z.object({
  id: z.string(),
  file_name: z.string(),
  content_type: z.string(),
  size_bytes: z.number().int(),
});

function toSummary(row: unknown): NewsAttachmentSummary {
  const parsed = attachmentRowSchema.parse(row);
  return {
    id: parsed.id,
    fileName: parsed.file_name,
    contentType: parsed.content_type,
    sizeBytes: parsed.size_bytes,
  };
}

/** Una dirección firmada que descarga el fichero con el nombre con el que se
 * subió. Null si Storage no la firmó (el fichero ya no está, por ejemplo
 * porque alguien lo borró desde el dashboard), con el motivo registrado. Un
 * fallo de la llamada entera sí se lanza. */
async function signDownloadUrl(
  serviceClient: SupabaseClient,
  file: { readonly storagePath: string; readonly fileName: string },
  lifetimeSeconds: number,
): Promise<string | null> {
  const { data, error } = await serviceClient.storage
    .from(NEWS_ATTACHMENTS_BUCKET)
    .createSignedUrls([file.storagePath], lifetimeSeconds, {
      download: file.fileName,
    });
  if (error) {
    throw new Error(
      `No se pudo firmar el adjunto ${file.storagePath}: ${error.message}`,
    );
  }
  const signed = data[0];
  if (signed === undefined || signed.error !== null) {
    console.error(
      `[news-attachments] no se pudo firmar el adjunto ${file.storagePath}: ${signed?.error ?? "sin respuesta"}`,
    );
    return null;
  }
  return signed.signedUrl;
}

function createAttachmentsGateway(
  serviceClient: SupabaseClient,
): NewsAttachmentGateways["attachments"] {
  return {
    async insertAttachment(attachment) {
      const { data, error } = await serviceClient
        .from(ATTACHMENTS_TABLE)
        .insert({
          post_id: attachment.postId,
          club_id: attachment.clubId,
          file_name: attachment.fileName,
          content_type: attachment.contentType,
          size_bytes: attachment.sizeBytes,
          storage_path: attachment.storagePath,
        })
        .select("id, file_name, content_type, size_bytes")
        .single();
      if (error?.message.includes(MAX_PER_POST_VIOLATION)) {
        throw new NewsAttachmentValidationError("attachment_limit_reached");
      }
      if (error) {
        throw new Error(
          `No se pudo guardar el adjunto de la publicación ${attachment.postId}: ${error.message}`,
        );
      }
      return toSummary(data);
    },

    async findStoragePath({ postId, attachmentId }) {
      const { data, error } = await serviceClient
        .from(ATTACHMENTS_TABLE)
        .select("storage_path")
        .eq("id", attachmentId)
        .eq("post_id", postId)
        .maybeSingle();
      if (error) {
        throw new Error(
          `No se pudo leer el adjunto ${attachmentId}: ${error.message}`,
        );
      }
      return data === null ? null : z.string().parse(data.storage_path);
    },

    async deleteAttachment(attachmentId) {
      const { error } = await serviceClient
        .from(ATTACHMENTS_TABLE)
        .delete()
        .eq("id", attachmentId);
      if (error) {
        throw new Error(
          `No se pudo quitar el adjunto ${attachmentId}: ${error.message}`,
        );
      }
    },
  };
}

type Bucket = ReturnType<SupabaseClient["storage"]["from"]>;

/** Lo que Storage sabe del fichero, o null si no está. El nombre con el que
 * se subió viaja en sus metadatos: un fichero sin él, o de un tipo que el
 * dominio no admite, no lo subió este adaptador y no se da por bueno. */
async function describeStoredFile(
  bucket: Bucket,
  storagePath: string,
): Promise<StoredNewsFile | null> {
  const { data, error } = await bucket.info(storagePath);
  if (error && "code" in error && error.code === NOT_FOUND_CODE) {
    return null;
  }
  if (error) {
    throw new Error(
      `No se pudo leer el adjunto ${storagePath}: ${error.message}`,
    );
  }
  const parsed = storedFileSchema.safeParse(data);
  if (!parsed.success) {
    console.error(
      `[news-attachments] el fichero ${storagePath} no tiene la forma de una subida`,
      parsed.error,
    );
    return null;
  }
  return {
    fileName: parsed.data.metadata[FILE_NAME_METADATA_KEY],
    contentType: parsed.data.contentType,
    sizeBytes: parsed.data.size,
    createdAt: parsed.data.createdAt,
  };
}

function createStorageGateway(
  serviceClient: SupabaseClient,
  urlLifetimeSeconds: number,
): NewsAttachmentGateways["storage"] {
  const bucket = serviceClient.storage.from(NEWS_ATTACHMENTS_BUCKET);
  return {
    async upload({ storagePath, bytes, contentType, fileName }) {
      const { error } = await bucket.upload(storagePath, bytes, {
        contentType,
        upsert: false,
        metadata: { [FILE_NAME_METADATA_KEY]: fileName },
      });
      if (error) {
        throw new Error(
          `No se pudo subir el adjunto ${storagePath}: ${error.message}`,
        );
      }
    },

    async remove(storagePaths) {
      const listed = storagePaths.join(", ");
      const { data, error } = await bucket.remove([...storagePaths]);
      if (error) {
        throw new Error(
          `No se pudo borrar el adjunto ${listed}: ${error.message}`,
        );
      }
      // Storage responde bien aunque no haya borrado nada: una lista más
      // corta es la única señal de que algún fichero sigue ahí.
      if (data.length < storagePaths.length) {
        throw new Error(`Storage no borró todo el adjunto ${listed}.`);
      }
    },

    describe: (storagePath) => describeStoredFile(bucket, storagePath),

    async copy(fromPath, toPath) {
      const { error } = await bucket.copy(fromPath, toPath);
      if (error) {
        throw new Error(
          `No se pudo copiar el adjunto ${fromPath} a ${toPath}: ${error.message}`,
        );
      }
    },

    async list(folder) {
      const { data, error } = await bucket.list(folder, {
        limit: LIST_PAGE_SIZE,
        sortBy: { column: "created_at", order: "asc" },
      });
      if (error) {
        throw new Error(
          `No se pudo listar la carpeta ${folder}: ${error.message}`,
        );
      }
      // Las carpetas vienen sin fecha: sólo interesan los ficheros.
      return data.flatMap((file) =>
        file.created_at === null
          ? []
          : [
              {
                storagePath: `${folder}/${file.name}`,
                createdAt: file.created_at,
              },
            ],
      );
    },

    signDownloadUrl: (file) =>
      signDownloadUrl(serviceClient, file, urlLifetimeSeconds),
  };
}

/** La vida de la dirección se puede acortar para que la integración
 * compruebe que caduca sin esperar cinco minutos. */
export function createNewsAttachmentGateways(
  serviceClient: SupabaseClient,
  urlLifetimeSeconds: number = NEWS_ATTACHMENT_URL_LIFETIME_SECONDS,
): NewsAttachmentGateways {
  return {
    ...createNewsGateways(serviceClient),
    attachments: createAttachmentsGateway(serviceClient),
    storage: createStorageGateway(serviceClient, urlLifetimeSeconds),
    newFileId: randomUUID,
  };
}

export type NewsAttachmentGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: NewsAttachmentGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición para los endpoints de adjuntos. Devuelve las
 * variables que faltan en vez de lanzar, como las demás. */
export function createSupabaseNewsAttachmentGateways(
  env: Environment,
): NewsAttachmentGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createNewsAttachmentGateways(createServiceRoleClient(env)),
  };
}
