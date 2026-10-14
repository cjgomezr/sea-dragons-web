import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { NewsInlineImagesGateway } from "./news-inline-images";

/**
 * Las imágenes del cuerpo de las publicaciones contra Supabase (#603).
 *
 * Todo va por la llave de servicio, como las portadas: los ficheros viven en
 * el bucket privado de los adjuntos (`0030_news_attachments.sql`), que no
 * tiene ninguna policy, y la tabla `news_inline_images` tampoco se la deja
 * leer a `authenticated`. A quién se le firma una lo decide el dominio con
 * la audiencia.
 */

/** El bucket de los adjuntos: admite WebP, y su límite de 10 MB es el de la
 * imagen. */
const INLINE_IMAGES_BUCKET = "news-attachments";

/** Diez minutos: la dirección estable redirige a esta en cada carga, así que
 * no hace falta que dure lo que la pestaña abierta, sólo más que la caché de
 * la redirección (`NEWS_INLINE_IMAGE_REDIRECT_MAX_AGE_SECONDS`). */
export const NEWS_INLINE_IMAGE_URL_LIFETIME_SECONDS = 10 * 60;

const INLINE_IMAGES_TABLE = "news_inline_images";

const STORED_TYPE = "image/webp";

/** Las abandonadas de una persona son pocas; una página basta. */
const STALE_PAGE_SIZE = 100;

const imageRowSchema = z.object({
  id: z.string(),
  club_id: z.string(),
  uploaded_by: z.string(),
  post_id: z.string().nullable(),
});

const imageRefSchema = z.object({ id: z.string(), club_id: z.string() });

function toImageRef(row: unknown): { id: string; clubId: string } {
  const parsed = imageRefSchema.parse(row);
  return { id: parsed.id, clubId: parsed.club_id };
}

async function findImages(
  serviceClient: SupabaseClient,
  imageIds: readonly string[],
): ReturnType<NewsInlineImagesGateway["findImages"]> {
  const { data, error } = await serviceClient
    .from(INLINE_IMAGES_TABLE)
    .select("id, club_id, uploaded_by, post_id")
    .in("id", [...imageIds]);
  if (error) {
    throw new Error(
      `No se pudieron leer las imágenes ${imageIds.join(", ")}: ${error.message}`,
    );
  }
  return data.map((row) => {
    const parsed = imageRowSchema.parse(row);
    return {
      id: parsed.id,
      clubId: parsed.club_id,
      uploadedBy: parsed.uploaded_by,
      postId: parsed.post_id,
    };
  });
}

async function findPostImages(
  serviceClient: SupabaseClient,
  postId: string,
): ReturnType<NewsInlineImagesGateway["findPostImages"]> {
  const { data, error } = await serviceClient
    .from(INLINE_IMAGES_TABLE)
    .select("id, club_id")
    .eq("post_id", postId);
  if (error) {
    throw new Error(
      `No se pudieron leer las imágenes de la publicación ${postId}: ${error.message}`,
    );
  }
  return data.map(toImageRef);
}

async function findStaleImages(
  serviceClient: SupabaseClient,
  query: Parameters<NewsInlineImagesGateway["findStaleImages"]>[0],
): ReturnType<NewsInlineImagesGateway["findStaleImages"]> {
  const { data, error } = await serviceClient
    .from(INLINE_IMAGES_TABLE)
    .select("id, club_id")
    .eq("uploaded_by", query.uploadedBy)
    .is("post_id", null)
    .lt("created_at", query.createdBefore)
    .order("created_at", { ascending: true })
    .limit(STALE_PAGE_SIZE);
  if (error) {
    throw new Error(
      `No se pudieron leer las imágenes de ${query.uploadedBy}: ${error.message}`,
    );
  }
  return data.map(toImageRef);
}

/** Una ruta sin firmar es un fichero que ya no está: para quien la pide, un
 * 404 y no un fallo del servidor. Se firma en lote, como los adjuntos, porque
 * así Storage separa ese caso del error de la llamada. */
async function signUrl(
  serviceClient: SupabaseClient,
  storagePath: string,
): Promise<string | null> {
  const { data, error } = await serviceClient.storage
    .from(INLINE_IMAGES_BUCKET)
    .createSignedUrls([storagePath], NEWS_INLINE_IMAGE_URL_LIFETIME_SECONDS);
  if (error) {
    throw new Error(
      `No se pudo firmar la imagen ${storagePath}: ${error.message}`,
    );
  }
  const signed = data[0];
  if (signed === undefined || signed.error !== null) {
    console.error(
      `[news-inline-images] no se pudo firmar la imagen ${storagePath}: ${signed?.error ?? "sin respuesta"}`,
    );
    return null;
  }
  return signed.signedUrl;
}

export function createNewsInlineImagesGateway(
  serviceClient: SupabaseClient,
): NewsInlineImagesGateway {
  const bucket = serviceClient.storage.from(INLINE_IMAGES_BUCKET);
  return {
    async upload({ storagePath, bytes }) {
      const { error } = await bucket.upload(storagePath, bytes, {
        contentType: STORED_TYPE,
        upsert: false,
      });
      if (error) {
        throw new Error(
          `No se pudo subir la imagen ${storagePath}: ${error.message}`,
        );
      }
    },

    async removeFiles(storagePaths) {
      const listed = storagePaths.join(", ");
      const { data, error } = await bucket.remove([...storagePaths]);
      if (error) {
        throw new Error(
          `No se pudo borrar la imagen ${listed}: ${error.message}`,
        );
      }
      // Storage responde bien aunque no haya borrado nada: una lista más
      // corta es la única señal de que algún fichero sigue ahí.
      if (data.length < storagePaths.length) {
        throw new Error(`Storage no borró la imagen ${listed}.`);
      }
    },

    signUrl: (storagePath) => signUrl(serviceClient, storagePath),

    async insertImage(image) {
      const { error } = await serviceClient.from(INLINE_IMAGES_TABLE).insert({
        id: image.id,
        club_id: image.clubId,
        uploaded_by: image.uploadedBy,
      });
      if (error) {
        throw new Error(
          `No se pudo guardar la imagen ${image.id}: ${error.message}`,
        );
      }
    },

    findImages: (imageIds) => findImages(serviceClient, imageIds),

    findPostImages: (postId) => findPostImages(serviceClient, postId),

    async linkImages({ postId, imageIds }) {
      // `is post_id null`: una imagen que otra publicación ligó entre leerla
      // y guardar no se le quita.
      const { error } = await serviceClient
        .from(INLINE_IMAGES_TABLE)
        .update({ post_id: postId })
        .in("id", [...imageIds])
        .is("post_id", null);
      if (error) {
        throw new Error(
          `No se pudieron ligar las imágenes a la publicación ${postId}: ${error.message}`,
        );
      }
    },

    findStaleImages: (query) => findStaleImages(serviceClient, query),

    async deleteImage(imageId) {
      const { error } = await serviceClient
        .from(INLINE_IMAGES_TABLE)
        .delete()
        .eq("id", imageId);
      if (error) {
        throw new Error(
          `No se pudo borrar la imagen ${imageId}: ${error.message}`,
        );
      }
    },
  };
}
