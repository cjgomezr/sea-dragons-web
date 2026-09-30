"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_LOCALE, type Locale, isLocale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

const SKELETON_BLOCK_COUNT = 3;

// El idioma no cambia mientras el esqueleto está en pantalla: cambiarlo
// recarga la ruta entera.
function subscribeToNothing(): () => void {
  return () => {};
}

// Next precarga este estado sin leer la petición, así que no puede saber la
// cookie del idioma. El servidor ya la leyó para el `lang` del documento.
function readDocumentLocale(): Locale {
  const lang = document.documentElement.lang;
  return isLocale(lang) ? lang : DEFAULT_LOCALE;
}

function readServerLocale(): Locale {
  return DEFAULT_LOCALE;
}

/** Lo que enseña una sección mientras el servidor contesta (#435): la forma
 * de una pantalla, sin texto a la vista. El título ocupa lo mismo que el
 * `h1` que llega después, para que el cambio no lo mueva de sitio. */
export function SectionLoading(): React.JSX.Element {
  const locale = useSyncExternalStore(
    subscribeToNothing,
    readDocumentLocale,
    readServerLocale,
  );
  const translate = createTranslator(locale);
  return (
    <div className="section-loading" role="status">
      <span className="visually-hidden">{translate("section.loading")}</span>
      <div className="section-loading-title" aria-hidden="true" />
      {Array.from({ length: SKELETON_BLOCK_COUNT }, (_, index) => (
        <div key={index} className="section-loading-block" aria-hidden="true" />
      ))}
    </div>
  );
}
