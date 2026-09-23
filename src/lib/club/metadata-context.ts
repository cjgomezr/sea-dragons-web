import { readRequestLocale } from "@/lib/i18n/request-locale";
import { createTranslator, type Translator } from "@/lib/i18n/translator";
import { readClubBrand } from "./supabase-club-brand";

export type MetadataContext = {
  readonly translate: Translator;
  /** El nombre guardado en la base, que los títulos de pestaña reciben como
   * el dato `{club}` (#293). */
  readonly club: string;
};

/** Lo que necesita el `generateMetadata` de una pantalla: el idioma de la
 * visita y el nombre del club, leídos a la vez. */
export async function readMetadataContext(): Promise<MetadataContext> {
  const [locale, brand] = await Promise.all([
    readRequestLocale(),
    readClubBrand(),
  ]);
  return { translate: createTranslator(locale), club: brand.name };
}
