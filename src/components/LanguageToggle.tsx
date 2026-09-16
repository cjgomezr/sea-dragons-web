"use client";

import { useRouter } from "next/navigation";
import { type Locale, otherLocale } from "@/lib/i18n/locale";
import { localeCookie } from "@/lib/i18n/locale-cookie";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * Cambiar de idioma (E17 RF-3). A diferencia del tema, el idioma no se puede
 * aplicar en el navegador: los textos los arma el servidor, que lo lee de la
 * cookie en cada petición. Por eso el botón escribe la cookie y pide la
 * pantalla otra vez, y el idioma que muestra llega como prop de esa respuesta
 * en vez de adivinarse aquí.
 *
 * `router.refresh()` y no una recarga completa: rehace los componentes de
 * servidor conservando el estado del navegador, así que lo escrito en un
 * formulario no se pierde. También invalida lo que el router tenía guardado
 * de otras pantallas, que estaba en el idioma anterior.
 */
export function LanguageToggle({
  locale,
}: {
  locale: Locale;
}): React.JSX.Element {
  const router = useRouter();
  const translate = createTranslator(locale);
  const label = translate("languageToggle.label");

  function handleToggle(): void {
    document.cookie = localeCookie(otherLocale(locale));
    router.refresh();
  }

  return (
    <button
      type="button"
      className="language-toggle"
      onClick={handleToggle}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">{translate("languageToggle.target")}</span>
    </button>
  );
}
