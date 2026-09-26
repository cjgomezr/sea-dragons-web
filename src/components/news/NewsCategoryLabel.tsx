import type { Translator } from "@/lib/i18n/translator";
import type { NewsCategory } from "@/lib/news/news-posts";

const CATEGORY_KEYS = {
  announcement: "news.category.announcement",
  news: "news.category.news",
  document: "news.category.document",
} as const satisfies Record<NewsCategory, string>;

/** La etiqueta de categoría del mockup de Noticias (#329). El color ayuda a
 * reconocerla de un vistazo, pero es el texto el que la nombra. */
export function NewsCategoryLabel({
  translate,
  category,
}: {
  readonly translate: Translator;
  readonly category: NewsCategory;
}): React.JSX.Element {
  return (
    <span className={`news-category news-category-${category}`}>
      {translate(CATEGORY_KEYS[category])}
    </span>
  );
}
