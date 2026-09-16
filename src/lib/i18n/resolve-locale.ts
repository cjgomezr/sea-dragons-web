import { DEFAULT_LOCALE, type Locale, isLocale } from "./locale";

export type LocaleHints = {
  readonly cookie: string | undefined;
  readonly acceptLanguage: string | null;
};

type WeightedTag = { readonly tag: string; readonly weight: number };

const FULL_WEIGHT = 1;

/** `q=0.8` → 0.8. Un peso ausente vale 1; uno ilegible también, porque la
 * cabecera la escribe el navegador y un error suyo no debe dejar a nadie sin
 * idioma. */
function parseWeight(parameters: readonly string[]): number {
  const quality = parameters
    .map((parameter) => parameter.trim().toLowerCase())
    .find((parameter) => parameter.startsWith("q="));
  if (quality === undefined) {
    return FULL_WEIGHT;
  }
  const weight = Number.parseFloat(quality.slice("q=".length));
  return Number.isNaN(weight) ? FULL_WEIGHT : weight;
}

function parseAcceptLanguage(header: string): WeightedTag[] {
  return header
    .split(",")
    .map((entry) => {
      const [tag = "", ...parameters] = entry.split(";");
      return { tag: tag.trim(), weight: parseWeight(parameters) };
    })
    .filter(({ tag, weight }) => tag !== "" && weight > 0);
}

/** `es-AR` habla `es`: la región no cambia el catálogo. */
function primaryLanguage(tag: string): string {
  const [language = ""] = tag.toLowerCase().split("-");
  return language;
}

/** El primer idioma de `accept-language` que la aplicación habla, en el
 * orden de preferencia del navegador: por peso y, a igual peso, por posición
 * (`sort` es estable). `null` si no habla ninguno. */
export function localeFromAcceptLanguage(header: string | null): Locale | null {
  if (header === null) {
    return null;
  }
  const spoken = parseAcceptLanguage(header)
    .sort((first, second) => second.weight - first.weight)
    .map(({ tag }) => primaryLanguage(tag))
    .find(isLocale);
  return spoken ?? null;
}

/** E17 RF-2: la cookie manda, luego el navegador, y el inglés de respaldo. Una
 * cookie con un valor que no es un idioma se trata como si no existiera. */
export function resolveLocale({ cookie, acceptLanguage }: LocaleHints): Locale {
  if (isLocale(cookie)) {
    return cookie;
  }
  return localeFromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}
