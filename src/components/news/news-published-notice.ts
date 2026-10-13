import { z } from "zod";

/**
 * El aviso de "publicada" que el feed enseña al volver de publicar (#597,
 * RF-13 del PRD de E22). Publicar navega al feed sin recargar, así que el
 * formulario lo deja en `sessionStorage` y el feed lo recoge una sola vez.
 * Se guarda a quién se avisó y no la frase, que el feed arma en su idioma.
 */

export type PublishedAudience =
  | { readonly kind: "club" }
  | { readonly kind: "groups"; readonly groupNames: readonly string[] };

const STORAGE_KEY = "noticias-aviso-publicada";

const publishedAudienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("club") }),
  z.object({ kind: z.literal("groups"), groupNames: z.array(z.string()) }),
]);

export function rememberPublishedNotice(audience: PublishedAudience): void {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(audience));
}

function parseStored(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    // Lo escribe sólo este módulo: si no se lee, se perdió un aviso y el
    // feed sigue igual. Se registra para no esconderlo.
    console.warn("El aviso de publicada guardado no se pudo leer.", error);
    return null;
  }
}

/** El aviso pendiente, o null. Sólo lee: quien lo enseña lo olvida después. */
export function readPublishedNotice(): PublishedAudience | null {
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return null;
  }
  const parsed = publishedAudienceSchema.safeParse(parseStored(raw));
  return parsed.success ? parsed.data : null;
}

/** Sale una sola vez: tras enseñarlo, se borra. */
export function forgetPublishedNotice(): void {
  window.sessionStorage.removeItem(STORAGE_KEY);
}
