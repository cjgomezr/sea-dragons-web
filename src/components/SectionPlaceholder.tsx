import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import type { NavLabelKey } from "@/lib/navigation";

/** El título es la misma clave que nombra la sección en el menú, así que la
 * pantalla y el enlace que lleva a ella no pueden llamarse distinto. */
export function SectionPlaceholder({
  locale,
  titleKey,
}: {
  locale: Locale;
  titleKey: NavLabelKey;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  return (
    <>
      <h1>{translate(titleKey)}</h1>
      <p className="app-lead">{translate("section.underConstruction")}</p>
    </>
  );
}
