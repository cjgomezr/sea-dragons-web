/** Los idiomas que habla la aplicación (E17). Añadir uno obliga a darle su
 * catálogo en `message-catalogs.ts`: el compilador no deja olvidarlo. */
export type Locale = "en" | "es";

const SUPPORTED_LOCALES: readonly Locale[] = ["en", "es"];

/** El idioma de quien llega sin ninguna pista: la mayoría del club habla
 * inglés (PRD E17). */
export const DEFAULT_LOCALE: Locale = "en";

/** La elección vive en una cookie y no en el almacenamiento local, como el
 * tema, porque las pantallas se arman en el servidor y el servidor sólo ve lo
 * que viaja con la petición. */
export const LOCALE_COOKIE_NAME = "seadragons-locale";

export function isLocale(value: unknown): value is Locale {
  return SUPPORTED_LOCALES.some((locale) => locale === value);
}
