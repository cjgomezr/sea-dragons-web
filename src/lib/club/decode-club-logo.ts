import sharp from "sharp";

/**
 * Si los bytes de un logo se decodifican enteros (#295). Aparte de
 * `club-logo.ts` porque ese módulo también lo importa la pantalla, y sharp
 * sólo corre en el servidor, como en `shrink-profile-photo.ts`.
 *
 * El logo se guarda tal cual lo subió el Admin, sin reducirlo: pesa como
 * mucho 512 KB y un correo lo puede pedir en PNG. Aquí sólo se decodifica.
 */

/** Un logo no necesita más de 4096 × 4096. El tope corta antes de
 * decodificar un PNG pequeño que se despliega en gigas de píxeles. */
const LOGO_MAX_INPUT_PIXELS = 4096 * 4096;

export async function isDecodableLogo(bytes: Uint8Array): Promise<boolean> {
  try {
    // `failOn: "truncated"` hace fallar también un fichero cortado, que por
    // defecto sharp pinta a medias sin quejarse.
    await sharp(bytes, {
      failOn: "truncated",
      limitInputPixels: LOGO_MAX_INPUT_PIXELS,
    })
      .raw()
      .toBuffer();
    return true;
  } catch (error) {
    console.warn("[club-logo] no se pudo decodificar el logo", error);
    return false;
  }
}
