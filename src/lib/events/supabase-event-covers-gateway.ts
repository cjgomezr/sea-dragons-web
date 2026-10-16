import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { shrinkNewsCover } from "@/lib/news/shrink-news-cover";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  EventCoverUploadGateways,
  EventCoversGateway,
} from "./event-covers";

/**
 * Las imágenes de eventos contra Supabase (#644).
 *
 * Todo va por la llave de servicio. Los ficheros viven en el bucket privado
 * `event-covers` (`0072_event_covers.sql`), que no tiene ninguna policy, y la
 * tabla `event_cover_uploads` tampoco se la deja leer a `authenticated`: a
 * quién se le firma una imagen lo decide el dominio con la audiencia.
 */

const COVERS_BUCKET = "event-covers";

/** Una hora, como la portada de noticias: la imagen se pinta al cargar la
 * agenda, así que una dirección de cinco minutos se rompería en una pestaña
 * abierta. */
export const EVENT_COVER_URL_LIFETIME_SECONDS = 60 * 60;

const COVERS_TABLE = "event_cover_uploads";

const STORED_TYPE = "image/webp";

type Environment = Readonly<Record<string, string | undefined>>;

const coverRowSchema = z.object({
  id: z.string(),
  club_id: z.string(),
  uploaded_by: z.string().nullable(),
});

async function signUrls(
  serviceClient: SupabaseClient,
  storagePaths: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const { data, error } = await serviceClient.storage
    .from(COVERS_BUCKET)
    .createSignedUrls([...storagePaths], EVENT_COVER_URL_LIFETIME_SECONDS);
  if (error) {
    throw new Error(
      `No se pudieron firmar las imágenes de eventos: ${error.message}`,
    );
  }
  // Una ruta sin firmar es un fichero que ya no está: la pantalla pinta el
  // fondo del tipo en vez de fallar.
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
): ReturnType<EventCoversGateway["findCover"]> {
  const { data, error } = await serviceClient
    .from(COVERS_TABLE)
    .select("id, club_id, uploaded_by")
    .eq("id", coverId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer la imagen de evento ${coverId}: ${error.message}`,
    );
  }
  if (data === null) {
    return null;
  }
  const row = coverRowSchema.parse(data);
  return { id: row.id, clubId: row.club_id, uploadedBy: row.uploaded_by };
}

export function createSupabaseEventCoversGateway(
  serviceClient: SupabaseClient,
): EventCoversGateway {
  const bucket = serviceClient.storage.from(COVERS_BUCKET);
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
        throw new Error(`Storage no borró toda la imagen ${listed}.`);
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
          `No se pudo guardar la imagen ${cover.id}: ${error.message}`,
        );
      }
    },

    findCover: (coverId) => findCover(serviceClient, coverId),
  };
}

export type EventCoverUploadGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: EventCoverUploadGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición para subir una imagen. Devuelve las variables que
 * faltan en vez de lanzar, como las demás. */
export function createSupabaseEventCoverUploadGateways(
  env: Environment,
): EventCoverUploadGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  const serviceClient = createServiceRoleClient(env);
  return {
    kind: "ready",
    gateways: {
      members: createRoleRequestGateways(serviceClient).members,
      eventCovers: createSupabaseEventCoversGateway(serviceClient),
      images: { shrinkCover: shrinkNewsCover },
      newFileId: randomUUID,
    },
  };
}
