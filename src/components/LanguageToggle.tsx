"use client";

import { useChooseLocale } from "@/components/use-choose-locale";
import { type Locale, otherLocale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

/** El botón de idioma de las pantallas de entrada: lleva al otro idioma. Cómo
 * se cambia lo explica `useChooseLocale`. */
export function LanguageToggle({
  locale,
}: {
  locale: Locale;
}): React.JSX.Element {
  const chooseLocale = useChooseLocale();
  const translate = createTranslator(locale);
  const label = translate("languageToggle.label");

  return (
    <button
      type="button"
      className="language-toggle"
      onClick={() => chooseLocale(otherLocale(locale))}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">{translate("languageToggle.target")}</span>
    </button>
  );
}
