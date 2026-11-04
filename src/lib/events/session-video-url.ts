/**
 * Qué enlace vale como vídeo de una sesión (#965, RF-4 y D7 del PRD de E37).
 * Los vídeos del club están en YouTube y son públicos, así que sólo vale el
 * enlace de un vídeo de YouTube por https, en cualquiera de las formas en que
 * YouTube lo comparte. Un canal o una lista no son el vídeo de una sesión.
 *
 * Es pura y sin dependencias para que la corran igual el campo de la pantalla
 * y el servidor.
 */

/** El límite de `events_video_url_length`, medido tras recortar. */
export const SESSION_VIDEO_URL_MAX_LENGTH = 300;

export type SessionVideoUrlIssue = "not_youtube_video" | "too_long";

export type SessionVideoUrlParse =
  | { readonly kind: "valid"; readonly url: string }
  | { readonly kind: "invalid"; readonly issue: SessionVideoUrlIssue };

/** Con o sin `www.` o `m.`, como los comparten la web y el móvil. */
const OPTIONAL_HOST_PREFIX = /^(?:www\.|m\.)/;

const SHORT_LINK_HOST = "youtu.be";
const SITE_HOST = "youtube.com";

/** Los ids de YouTube son letras, cifras, `-` y `_`. */
const VIDEO_ID = /^[\w-]+$/;

/** `/live/<id>` y `/shorts/<id>`, con o sin barra final. */
const VIDEO_PATH = /^\/(?:live|shorts)\/([\w-]+)\/?$/;

/** `youtu.be/<id>`, con o sin barra final. */
const SHORT_LINK_PATH = /^\/([\w-]+)\/?$/;

const WATCH_PATH = "/watch";

function parseLink(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    // `new URL` sólo lanza si no es un enlace: eso es lo que se pregunta.
    return null;
  }
}

/** Un enlace sin usuario ni puerto: lo que se enseña es lo que se abre. */
function isPlainHttpsLink(link: URL): boolean {
  return (
    link.protocol === "https:" &&
    link.username === "" &&
    link.password === "" &&
    link.port === ""
  );
}

function isVideoOnSite(link: URL): boolean {
  if (link.pathname === WATCH_PATH) {
    return VIDEO_ID.test(link.searchParams.get("v") ?? "");
  }
  return VIDEO_PATH.test(link.pathname);
}

function isYoutubeVideo(link: URL): boolean {
  // `URL` ya deja el dominio en minúsculas.
  const host = link.hostname.replace(OPTIONAL_HOST_PREFIX, "");
  if (host === SHORT_LINK_HOST) {
    return SHORT_LINK_PATH.test(link.pathname);
  }
  return host === SITE_HOST && isVideoOnSite(link);
}

/** El enlace recortado, listo para guardar, o por qué no vale. */
export function parseSessionVideoUrl(input: string): SessionVideoUrlParse {
  const url = input.trim();
  if (url.length > SESSION_VIDEO_URL_MAX_LENGTH) {
    return { kind: "invalid", issue: "too_long" };
  }
  const link = parseLink(url);
  if (link === null || !isPlainHttpsLink(link) || !isYoutubeVideo(link)) {
    return { kind: "invalid", issue: "not_youtube_video" };
  }
  return { kind: "valid", url };
}
