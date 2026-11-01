import { z } from "zod";

/**
 * El aviso de "publicada" que el feed enseña al volver de publicar (#597,
 * RF-13 del PRD de E22). Publicar navega al feed sin recargar, así que el
 * formulario lo deja en `sessionStorage` y el feed lo recoge una sola vez.
 * Se guarda a quién se avisó y no la frase, que el feed arma en su idioma.
 * Si salió fijada (#599), también hasta cuándo.
 */

export type PublishedAudience =
  | { readonly kind: "club" }
  | { readonly kind: "groups"; readonly groupNames: readonly string[] };

/** Si salió fijada, hasta cuándo (nula: hasta que la desfijen). */
export type PublishedPin =
  | { readonly kind: "none" }
  | { readonly kind: "pinned"; readonly until: string | null };

export type PublishedNotice = {
  readonly audience: PublishedAudience;
  readonly pin: PublishedPin;
};

const STORAGE_KEY = "noticias-aviso-publicada";

const publishedAudienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("club") }),
  z.object({ kind: z.literal("groups"), groupNames: z.array(z.string()) }),
]);

const publishedNoticeSchema = z.object({
  audience: publishedAudienceSchema,
  pin: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }),
    z.object({
      kind: z.literal("pinned"),
      until: z.iso.datetime({ offset: true }).nullable(),
    }),
  ]),
});

export function rememberPublishedNotice(notice: PublishedNotice): void {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(notice));
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
export function readPublishedNotice(): PublishedNotice | null {
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return null;
  }
  const parsed = publishedNoticeSchema.safeParse(parseStored(raw));
  return parsed.success ? parsed.data : null;
}

/** Sale una sola vez: tras enseñarlo, se borra. */
export function forgetPublishedNotice(): void {
  window.sessionStorage.removeItem(STORAGE_KEY);
}

/** Borrar una publicación (#958) también vuelve al feed sin recargar, y el
 * feed dice "Post deleted.". No hay nada más que guardar que la marca. */
const DELETED_STORAGE_KEY = "noticias-aviso-borrada";

export function rememberDeletedNotice(): void {
  window.sessionStorage.setItem(DELETED_STORAGE_KEY, "1");
}

/** Si hay aviso de borrada pendiente, y lo olvida: sale una sola vez. */
export function takeDeletedNotice(): boolean {
  const isPending = window.sessionStorage.getItem(DELETED_STORAGE_KEY) !== null;
  window.sessionStorage.removeItem(DELETED_STORAGE_KEY);
  return isPending;
}
