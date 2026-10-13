import type { Translator } from "@/lib/i18n/translator";
import { NEWS_CATEGORIES, type NewsCategory } from "@/lib/news/news-posts";

/**
 * La categoría como control segmentado (#597, el "#2b" del handoff de E22),
 * en lugar del `<select>` de #330. Son radios de verdad: las flechas cambian
 * la elegida y el lector de pantalla la anuncia sin más código. El radio
 * queda encima de su segmento, transparente, como en el diálogo de eventos.
 */

const NAME = "publicar-categoria";
const LEGEND_ID = `${NAME}-leyenda`;

export function NewsCategoryField({
  translate,
  category,
  onChange,
}: {
  readonly translate: Translator;
  readonly category: NewsCategory;
  readonly onChange: (category: NewsCategory) => void;
}): React.JSX.Element {
  return (
    <fieldset
      className="news-category-field"
      role="radiogroup"
      aria-labelledby={LEGEND_ID}
    >
      <legend id={LEGEND_ID}>{translate("news.publish.category")}</legend>
      <div className="news-category-segments">
        {NEWS_CATEGORIES.map((option) => {
          const id = `${NAME}-${option}`;
          return (
            <div className="news-category-segment" key={option}>
              <input
                id={id}
                type="radio"
                name={NAME}
                value={option}
                checked={option === category}
                onChange={() => onChange(option)}
              />
              <label htmlFor={id}>
                <span
                  className={`news-category-dot news-category-dot-${option}`}
                  aria-hidden="true"
                />
                {translate(`news.category.${option}`)}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
