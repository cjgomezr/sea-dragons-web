import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";
import { LOCALE_COOKIE_NAME, type Locale } from "./locale";
import { resolveLocale } from "./resolve-locale";

/** El idioma de la petición en curso, para componentes de servidor. Leer la
 * cookie y la cabecera vuelve dinámica la pantalla que lo llame: así ninguna
 * sale de una caché armada en el idioma de otra visita. */
export async function readRequestLocale(): Promise<Locale> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return resolveLocale({
    cookie: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: headerList.get("accept-language"),
  });
}

/** El idioma de una petición a la API, con las mismas pistas que una
 * pantalla. La web lo manda en su cookie; una app nativa (CON-002), en
 * `accept-language`. */
export function readApiRequestLocale(request: NextRequest): Locale {
  return resolveLocale({
    cookie: request.cookies.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: request.headers.get("accept-language"),
  });
}
