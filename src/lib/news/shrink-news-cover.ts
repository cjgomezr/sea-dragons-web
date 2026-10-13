import sharp, { type Sharp } from "sharp";

/**
 * La reducción de la portada de una publicación (#591, decisión D6 del PRD
 * de E22) a sus dos versiones, como la foto de perfil (#271, #353). Vive
 * aparte porque sharp es nativo: sólo corre en el servidor.
 */

/** La de las filas del feed: la miniatura mide 88 px y se dibuja a 2x. */
export const NEWS_COVER_THUMBNAIL_SIDE_PX = 176;

/** La de la tarjeta destacada y la publicación abierta, que llega a todo el
 * ancho de un escritorio. */
export const NEWS_COVER_LARGE_SIDE_PX = 1600;

/** Las mismas calidades que la foto de perfil: casi sin pérdida en la
 * miniatura, que pesa pocos KB igual, y 80 en la grande. */
const THUMBNAIL_WEBP_QUALITY = 90;
const LARGE_WEBP_QUALITY = 80;

/** Las dos versiones, o la señal de que los bytes empiezan como una imagen
 * admitida pero no se pueden decodificar. */
export type ShrunkNewsCover =
  | {
      readonly kind: "shrunk";
      readonly thumbnail: Uint8Array;
      readonly large: Uint8Array;
    }
  | { readonly kind: "undecodable" };

async function encodeVersion(
  oriented: Sharp,
  sidePx: number,
  quality: number,
): Promise<Uint8Array> {
  const encoded = await oriented
    .clone()
    .resize(sidePx, sidePx, { fit: "inside", withoutEnlargement: true })
    .webp({ quality, smartSubsample: true })
    .toBuffer();
  return new Uint8Array(encoded);
}

/** `rotate()` sin ángulo aplica la orientación EXIF, y sharp no copia los
 * metadatos (GPS, cámara) salvo que se le pida. Las dos salen juntas o no
 * sale ninguna. */
export async function shrinkNewsCover(
  bytes: Uint8Array,
): Promise<ShrunkNewsCover> {
  try {
    const oriented = sharp(bytes).rotate();
    const [thumbnail, large] = await Promise.all([
      encodeVersion(
        oriented,
        NEWS_COVER_THUMBNAIL_SIDE_PX,
        THUMBNAIL_WEBP_QUALITY,
      ),
      encodeVersion(oriented, NEWS_COVER_LARGE_SIDE_PX, LARGE_WEBP_QUALITY),
    ]);
    return { kind: "shrunk", thumbnail, large };
  } catch (error) {
    console.warn("[news-covers] no se pudo decodificar la portada", error);
    return { kind: "undecodable" };
  }
}
