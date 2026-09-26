import sharp, { type Sharp } from "sharp";
import type { PhotoVersion, ShrunkPhoto } from "./profile-photo";

/**
 * La reducción de la foto de perfil (#271, RF-9 del PRD de E5) a sus dos
 * tamaños (#353). Vive aparte de `profile-photo.ts` porque aquel lo importan
 * también componentes de cliente, y sharp es nativo: sólo corre en el
 * servidor.
 */

/** La de las listas: 160 px por el lado mayor cubren el avatar más grande,
 * de 64 px, a 2,5 veces de densidad. */
export const PROFILE_PHOTO_THUMBNAIL_SIDE_PX = 160;

/** La que se abre en grande: 1024 px cubren un modal de escritorio. Sólo se
 * descarga cuando alguien la pide, así que no pesa en el directorio. */
export const PROFILE_PHOTO_LARGE_SIDE_PX = 1024;

/** Una miniatura de 160 px pesa pocos KB a cualquier calidad, así que se
 * guarda casi sin pérdida: la queja de fotos pixeladas del 25 de septiembre
 * de 2026 no vuelve por ahorrar un par de KB por socio. */
const THUMBNAIL_WEBP_QUALITY = 90;

/** 80 deja una foto de 1024 px en decenas de KB sin artefactos visibles. */
const LARGE_WEBP_QUALITY = 80;

type VersionSpec = { readonly sidePx: number; readonly quality: number };

/** `smartSubsample` conserva los bordes de color, que en una miniatura son
 * casi toda la cara. */
async function encodeVersion(
  oriented: Sharp,
  { sidePx, quality }: VersionSpec,
): Promise<PhotoVersion> {
  const encoded = await oriented
    .clone()
    .resize(sidePx, sidePx, { fit: "inside", withoutEnlargement: true })
    .webp({ quality, smartSubsample: true })
    .toBuffer();
  return { bytes: new Uint8Array(encoded), type: "image/webp" };
}

/** WebP siempre, porque conserva la transparencia de un PNG y pesa menos que
 * JPEG a la misma calidad. `rotate()` sin ángulo aplica la orientación EXIF, y
 * sharp no copia metadatos (GPS, cámara) salvo que se le pida.
 *
 * Las dos versiones salen juntas o no sale ninguna: una ficha con miniatura y
 * sin grande (o al revés) es una foto a medias. */
export async function shrinkProfilePhoto(
  bytes: Uint8Array,
): Promise<ShrunkPhoto> {
  try {
    const oriented = sharp(bytes).rotate();
    const [thumbnail, large] = await Promise.all([
      encodeVersion(oriented, {
        sidePx: PROFILE_PHOTO_THUMBNAIL_SIDE_PX,
        quality: THUMBNAIL_WEBP_QUALITY,
      }),
      encodeVersion(oriented, {
        sidePx: PROFILE_PHOTO_LARGE_SIDE_PX,
        quality: LARGE_WEBP_QUALITY,
      }),
    ]);
    return { kind: "shrunk", thumbnail, large };
  } catch (error) {
    console.warn("[profile-photo] no se pudo decodificar la foto", error);
    return { kind: "undecodable" };
  }
}
