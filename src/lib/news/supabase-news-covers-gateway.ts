import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { NewsCoversGateway } from "./news-covers";

/**
 * Las portadas de las publicaciones contra Supabase (#591).
 *
 * Todo va por la llave de servicio. Los ficheros viven en el bucket privado
 * de los adjuntos (`0030_news_attachments.sql`), que no tiene ninguna policy,
 * y la tabla `news_cover_uploads` tampoco se la deja leer a `authenticated`:
 * a quién se le firma una portada lo decide el dominio con la audiencia.
 */

/** El bucket de los adjuntos: admite WebP, y su límite de 10 MB es el de la
 * portada. */
const COVERS_BUCKET = "news-attachments";

/** Una hora, como la foto de perfil: la portada se pinta al cargar el feed,
 * no al pulsar, así que una dirección de cinco minutos se rompería en una
 * pestaña abierta. */
export const NEWS_COVER_URL_LIFETIME_SECONDS = 60 * 60;

const COVERS_TABLE = "news_cover_uploads";

const STORED_TYPE = "image/webp";

/** Las abandonadas de una persona son pocas; una página basta. */
const STALE_PAGE_SIZE = 100;

const coverRowSchema = z.object({
  id: z.string(),
  club_id: z.string(),
  uploaded_by: z.string(),
  news_posts: z.array(z.object({ id: z.string() })),
});

function linkedPostOf(row: z.infer<typeof coverRowSchema>): string | null {
  const [post] = row.news_posts;
  return post === undefined ? null : post.id;
}

async function signUrls(
  serviceClient: SupabaseClient,
  storagePaths: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const { data, error } = await serviceClient.storage
    .from(COVERS_BUCKET)
    .createSignedUrls([...storagePaths], NEWS_COVER_URL_LIFETIME_SECONDS);
  if (error) {
    throw new Error(`No se pudieron firmar las portadas: ${error.message}`);
  }
  // Una ruta sin firmar es un fichero que ya no está: la pantalla pinta el
  // fondo de la categoría en vez de fallar.
  return new Map(
    data.flatMap(({ error: signError, path, signedUrl }) =>
      signError === null && path !== null && signedUrl !== null
        ? [[path, signedUrl] as const]
        : [],
    ),
  );
}

async function findCover(
  serviceClient: SupabaseClient,
  coverId: string,
): ReturnType<NewsCoversGateway["findCover"]> {
  const { data, error } = await serviceClient
    .from(COVERS_TABLE)
    .select("id, club_id, uploaded_by, news_posts(id)")
    .eq("id", coverId)
    .maybeSingle();
  if (error) {
    throw new Error(`No se pudo leer la portada ${coverId}: ${error.message}`);
  }
  if (data === null) {
    return null;
  }
  const row = coverRowSchema.parse(data);
  return {
    id: row.id,
    clubId: row.club_id,
    uploadedBy: row.uploaded_by,
    postId: linkedPostOf(row),
  };
}

async function findStaleCovers(
  serviceClient: SupabaseClient,
  query: Parameters<NewsCoversGateway["findStaleCovers"]>[0],
): ReturnType<NewsCoversGateway["findStaleCovers"]> {
  const { data, error } = await serviceClient
    .from(COVERS_TABLE)
    .select("id, club_id, uploaded_by, news_posts(id)")
    .eq("uploaded_by", query.uploadedBy)
    .lt("created_at", query.createdBefore)
    .order("created_at", { ascending: true })
    .limit(STALE_PAGE_SIZE);
  if (error) {
    throw new Error(
      `No se pudieron leer las portadas de ${query.uploadedBy}: ${error.message}`,
    );
  }
  return data
    .map((row) => coverRowSchema.parse(row))
    .filter((row) => linkedPostOf(row) === null)
    .map((row) => ({ id: row.id, clubId: row.club_id }));
}

export function createNewsCoversGateway(
  serviceClient: SupabaseClient,
): NewsCoversGateway {
  const bucket = serviceClient.storage.from(COVERS_BUCKET);
  return {
    async upload({ storagePath, bytes }) {
      const { error } = await bucket.upload(storagePath, bytes, {
        contentType: STORED_TYPE,
        upsert: false,
      });
      if (error) {
        throw new Error(
          `No se pudo subir la portada ${storagePath}: ${error.message}`,
        );
      }
    },

    async removeFiles(storagePaths) {
      const listed = storagePaths.join(", ");
      const { data, error } = await bucket.remove([...storagePaths]);
      if (error) {
        throw new Error(
          `No se pudo borrar la portada ${listed}: ${error.message}`,
        );
      }
      // Storage responde bien aunque no haya borrado nada: una lista más
      // corta es la única señal de que algún fichero sigue ahí.
      if (data.length < storagePaths.length) {
        throw new Error(`Storage no borró toda la portada ${listed}.`);
      }
    },

    signUrls: (storagePaths) => signUrls(serviceClient, storagePaths),

    async insertCover(cover) {
      const { error } = await serviceClient.from(COVERS_TABLE).insert({
        id: cover.id,
        club_id: cover.clubId,
        uploaded_by: cover.uploadedBy,
      });
      if (error) {
        throw new Error(
          `No se pudo guardar la portada ${cover.id}: ${error.message}`,
        );
      }
    },

    findCover: (coverId) => findCover(serviceClient, coverId),

    findStaleCovers: (query) => findStaleCovers(serviceClient, query),

    async deleteCover(coverId) {
      const { error } = await serviceClient
        .from(COVERS_TABLE)
        .delete()
        .eq("id", coverId);
      if (error) {
        throw new Error(
          `No se pudo borrar la portada ${coverId}: ${error.message}`,
        );
      }
    },
  };
}
