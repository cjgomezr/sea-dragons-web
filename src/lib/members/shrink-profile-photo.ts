import sharp from "sharp";
import type { ShrunkPhoto } from "./profile-photo";

/**
 * La reducción de la foto de perfil (#271, RF-9 del PRD de E5). Vive aparte
 * de `profile-photo.ts` porque aquel lo importan también componentes de
 * cliente, y sharp es nativo: sólo corre en el servidor.
 */

/** La ficha y el directorio nunca la enseñan más grande: 400 px por el lado
 * mayor cubren el doble de densidad del avatar más grande. */
export const PROFILE_PHOTO_MAX_SIDE_PX = 400;

/** 80 deja una foto de 400 px en decenas de KB sin artefactos visibles, así
 * que un directorio de 30 fotos pesa lo que antes pesaba una. */
const WEBP_QUALITY = 80;

/** WebP siempre, porque conserva la transparencia de un PNG y pesa menos que
 * JPEG a la misma calidad. `rotate()` sin ángulo aplica la orientación EXIF, y
 * sharp no copia metadatos (GPS, cámara) salvo que se le pida. */
export async function shrinkProfilePhoto(
  bytes: Uint8Array,
): Promise<ShrunkPhoto> {
  try {
    const shrunk = await sharp(bytes)
      .rotate()
      .resize(PROFILE_PHOTO_MAX_SIDE_PX, PROFILE_PHOTO_MAX_SIDE_PX, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    return {
      kind: "shrunk",
      bytes: new Uint8Array(shrunk),
      type: "image/webp",
    };
  } catch (error) {
    console.warn("[profile-photo] no se pudo decodificar la foto", error);
    return { kind: "undecodable" };
  }
}
