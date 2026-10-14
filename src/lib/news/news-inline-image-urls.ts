import { NEWS_INLINE_IMAGE_API_PATH } from "@/lib/auth/routes";

/**
 * La dirección con la que una imagen del cuerpo (#603, RF-14 del PRD de E22)
 * queda escrita en el Markdown. Es una ruta de la API y no una URL firmada:
 * la firmada caduca, y el cuerpo se guarda para siempre. Va sin dominio,
 * como cualquier llamada a la API: la web la resuelve contra su origen y la
 * aplicación nativa contra el suyo (CON-002).
 *
 * Sin dependencias de servidor: la usan el editor, que la inserta, y el
 * renderizador, que sólo deja pasar estas.
 */

const IMAGE_ID_PLACEHOLDER = "[imageId]";

const PATH_PREFIX = NEWS_INLINE_IMAGE_API_PATH.replace(
  IMAGE_ID_PLACEHOLDER,
  "",
);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function newsInlineImageUrlOf(imageId: string): string {
  return NEWS_INLINE_IMAGE_API_PATH.replace(IMAGE_ID_PLACEHOLDER, imageId);
}

/** El id de la imagen del club que nombra la dirección, o null si es
 * cualquier otra cosa: otro dominio, otra ruta o algo detrás del id. */
export function readNewsInlineImageId(url: string): string | null {
  if (!url.startsWith(PATH_PREFIX)) {
    return null;
  }
  const imageId = url.slice(PATH_PREFIX.length);
  return UUID_PATTERN.test(imageId) ? imageId : null;
}
