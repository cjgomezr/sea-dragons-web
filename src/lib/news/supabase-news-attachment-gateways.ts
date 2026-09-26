import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import {
  type NewsAttachmentGateways,
  NewsAttachmentValidationError,
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

type Environment = Readonly<Record<string, string | undefined>>;

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

function createStorageGateway(
  serviceClient: SupabaseClient,
  urlLifetimeSeconds: number,
): NewsAttachmentGateways["storage"] {
  const bucket = serviceClient.storage.from(NEWS_ATTACHMENTS_BUCKET);
  return {
    async upload(storagePath, bytes, type) {
      const { error } = await bucket.upload(storagePath, bytes, {
        contentType: type,
        upsert: false,
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
