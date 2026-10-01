"use client";

import { useCallback, useId, useRef, useState } from "react";
import { SearchIcon } from "@/components/NavIcons";
import { useDismissal } from "@/components/use-dismissal";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import { GlobalSearch } from "./GlobalSearch";
import type { SearchViewer } from "./search-destinations";

/**
 * La lupa del móvil, junto a la campana (#427, D4 del PRD de E14): abre la
 * búsqueda a pantalla completa con el foco en el cuadro, que es lo que saca
 * el teclado. Tiene la misma forma que la lista de la campana: su flecha para
 * cerrar, y salir de ella con el foco también la cierra, porque lo que queda
 * debajo no se ve.
 *
 * En escritorio la lupa no se pinta: el cuadro ya está en la barra de arriba.
 */
export function MobileSearch({
  locale,
  viewer,
}: {
  readonly locale: Locale;
  readonly viewer: SearchViewer;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const screenId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const close = useCallback(() => setIsOpen(false), []);
  const closeAndReturnFocus = useCallback(() => {
    setIsOpen(false);
    buttonRef.current?.focus();
  }, []);
  useDismissal({
    isOpen,
    containerRef,
    onEscape: closeAndReturnFocus,
    onPressOutside: close,
    onFocusOutside: close,
  });

  const label = translate("search.open");
  return (
    <div className="mobile-search" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        className="app-header-icon mobile-search-button"
        aria-label={label}
        title={label}
        aria-expanded={isOpen}
        aria-controls={screenId}
        onClick={() => setIsOpen((current) => !current)}
      >
        <SearchIcon />
      </button>
      {isOpen ? (
        <div
          id={screenId}
          role="dialog"
          // Tapa la pantalla entera, y sacar el foco de ella la cierra: lo de
          // debajo no se alcanza mientras está abierta.
          aria-modal="true"
          aria-label={translate("search.label")}
          className="search-screen"
        >
          <GlobalSearch
            locale={locale}
            viewer={viewer}
            layout="screen"
            onClose={closeAndReturnFocus}
            leading={
              <button
                type="button"
                className="notification-panel-back"
                onClick={closeAndReturnFocus}
              >
                <span aria-hidden="true">←</span>
                <span className="visually-hidden">
                  {translate("search.close")}
                </span>
              </button>
            }
          />
        </div>
      ) : null}
    </div>
  );
}
