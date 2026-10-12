import { FileText } from "@phosphor-icons/react/dist/ssr/FileText";
import { MegaphoneSimple } from "@phosphor-icons/react/dist/ssr/MegaphoneSimple";
import { Newspaper } from "@phosphor-icons/react/dist/ssr/Newspaper";
import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import type { NewsCategory } from "@/lib/news/news-posts";

/** Los tamaños del handoff de E22: la portada grande, la tarjeta y la
 * miniatura de la fila. */
export type FallbackIconSize = 88 | 64 | 32;

const CATEGORY_GLYPHS: Readonly<Record<NewsCategory, PhosphorGlyph>> = {
  announcement: MegaphoneSimple,
  news: Newspaper,
  document: FileText,
};

/** El fondo de lo que no tiene portada (#590): un degradado y un icono por
 * categoría. Es decorativo; la categoría la nombra su etiqueta. El degradado,
 * el tono y la opacidad del icono los pone la hoja de estilos; el alto, quien
 * lo usa. */
export function NewsCategoryFallback({
  category,
  iconSize,
}: {
  readonly category: NewsCategory;
  readonly iconSize: FallbackIconSize;
}): React.JSX.Element {
  const Glyph = CATEGORY_GLYPHS[category];
  return (
    <div className={`news-cover-fallback news-cover-fallback-${category}`}>
      <Glyph
        aria-hidden="true"
        focusable="false"
        size={iconSize}
        color="currentColor"
      />
    </div>
  );
}
