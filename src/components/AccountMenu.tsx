"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { LanguageToggle } from "@/components/LanguageToggle";
import { AccountIcon, SettingsIcon } from "@/components/NavIcons";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useDismissal } from "@/components/use-dismissal";
import { ACCOUNT_PAGE_PATH, CLUB_SETTINGS_PATH } from "@/lib/auth/routes";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator, type Translator } from "@/lib/i18n/translator";

/**
 * El menú de la cuenta (#287): Mi perfil, Apariencia, Idioma y Cerrar sesión
 * detrás de un solo botón, para que la cabecera quepa en una fila junto al
 * nombre del club. Al Admin le ofrece además la configuración del club
 * (#296). Se abre como la lista de avisos (#266): desplegable en
 * escritorio y pantalla entera con su flecha de volver en el móvil.
 *
 * Es de cliente porque abre y cierra. Cambiar de idioma rehace la cabecera en
 * el servidor, y este componente conserva su estado: el menú sigue abierto y
 * sale en el idioma nuevo.
 */

/** Lo que se queda con el foco al pulsarlo. */
const FOCUSABLE_SELECTOR =
  "a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]";

function canTakeFocus(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest(FOCUSABLE_SELECTOR) !== null
  );
}

function AccountMenuPanel({
  id,
  locale,
  translate,
  canConfigureClub,
  headingRef,
  onBack,
  onNavigate,
}: {
  readonly id: string;
  readonly locale: Locale;
  readonly canConfigureClub: boolean;
  readonly translate: Translator;
  readonly headingRef: React.Ref<HTMLHeadingElement>;
  readonly onBack: () => void;
  readonly onNavigate: () => void;
}): React.JSX.Element {
  const headingId = `${id}-titulo`;
  return (
    <section id={id} className="account-menu" aria-labelledby={headingId}>
      <div className="account-menu-header">
        <button type="button" className="account-menu-back" onClick={onBack}>
          <span aria-hidden="true">←</span>
          <span className="visually-hidden">
            {translate("accountMenu.back")}
          </span>
        </button>
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {translate("account.link")}
        </h2>
      </div>
      <ul className="account-menu-list">
        <li>
          <Link
            href={ACCOUNT_PAGE_PATH}
            className="account-menu-item"
            onClick={onNavigate}
          >
            <AccountIcon />
            {translate("accountMenu.profile")}
          </Link>
        </li>
        {canConfigureClub ? (
          <li>
            <Link
              href={CLUB_SETTINGS_PATH}
              className="account-menu-item"
              onClick={onNavigate}
            >
              <SettingsIcon />
              {translate("accountMenu.clubSettings")}
            </Link>
          </li>
        ) : null}
        <li className="account-menu-setting">
          <span>{translate("accountMenu.appearance")}</span>
          <ThemeToggle locale={locale} />
        </li>
        <li className="account-menu-setting">
          <span>{translate("accountMenu.language")}</span>
          <LanguageToggle locale={locale} />
        </li>
        <li>
          <SignOutButton locale={locale} />
        </li>
      </ul>
    </section>
  );
}

export function AccountMenu({
  locale,
  canConfigureClub,
}: {
  locale: Locale;
  /** Si quien lo abre es Admin: sólo entonces ofrece la configuración del
   * club. Lo decide el servidor con la regla de la frontera. */
  canConfigureClub: boolean;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const close = useCallback(() => setIsOpen(false), [setIsOpen]);
  const closeAndReturnFocus = useCallback(() => {
    setIsOpen(false);
    buttonRef.current?.focus();
  }, [setIsOpen]);
  // Un clic fuera sobre algo que toma el foco se lo cede; sobre cualquier
  // otra cosa el navegador lo dejaría en el `body`, y ahí se pierde quien
  // navega con teclado.
  const pressOutside = useCallback(
    (event: MouseEvent) => {
      if (canTakeFocus(event.target)) {
        close();
        return;
      }
      event.preventDefault();
      closeAndReturnFocus();
    },
    [close, closeAndReturnFocus],
  );
  useDismissal({
    isOpen,
    containerRef,
    onEscape: closeAndReturnFocus,
    onPressOutside: pressOutside,
    onFocusOutside: closeAndReturnFocus,
  });

  useEffect(() => {
    if (isOpen) {
      headingRef.current?.focus();
    }
  }, [isOpen]);

  const label = translate("account.link");
  return (
    <div className="account-menu-anchor" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        className="app-header-icon"
        aria-label={label}
        title={label}
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => setIsOpen((wasOpen) => !wasOpen)}
      >
        <AccountIcon />
      </button>
      {isOpen ? (
        <AccountMenuPanel
          id={menuId}
          locale={locale}
          translate={translate}
          canConfigureClub={canConfigureClub}
          headingRef={headingRef}
          onBack={closeAndReturnFocus}
          onNavigate={close}
        />
      ) : null}
    </div>
  );
}
