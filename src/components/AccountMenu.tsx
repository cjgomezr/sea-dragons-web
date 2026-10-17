"use client";

import { ArrowLeft } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { GearSix } from "@phosphor-icons/react/dist/ssr/GearSix";
import { UserCircle } from "@phosphor-icons/react/dist/ssr/UserCircle";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { Icon } from "@/components/Icon";
import { LanguageChoice } from "@/components/LanguageChoice";
import { MemberAvatar } from "@/components/MemberAvatar";
import { AccountIcon } from "@/components/NavIcons";
import { ThemeChoice } from "@/components/ThemeChoice";
import { useDismissal } from "@/components/use-dismissal";
import type { MemberIdentity } from "@/lib/auth/caller-identity";
import type { Role } from "@/lib/auth/roles";
import { ACCOUNT_PAGE_PATH, CLUB_SETTINGS_PATH } from "@/lib/auth/routes";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator, type Translator } from "@/lib/i18n/translator";
import { isSectionActive } from "@/lib/navigation";

/**
 * El menú de la cuenta (#287, rehecho en #716): quién tiene la sesión arriba,
 * Mi perfil, la configuración del club a quien puede cambiarla (#296),
 * Apariencia e Idioma como controles segmentados y Cerrar sesión. Se abre
 * como la lista de avisos (#266): desplegable en escritorio y pantalla entera
 * con su flecha de volver en el móvil.
 *
 * Es de cliente porque abre y cierra. Cambiar de idioma rehace la cabecera en
 * el servidor, y este componente conserva su estado: el menú sigue abierto y
 * sale en el idioma nuevo.
 */

/** Lo que el menú pone arriba: el nombre y el correo de su fila de miembro,
 * con el rol que ya decide la navegación. */
export type AccountIdentity = MemberIdentity & { readonly role: Role };

/** `MemberAvatar` pide una medida; la que manda es la del CSS, 40 px en
 * escritorio y 52 en el móvil. */
const AVATAR_SIZE = 52;

/** Lo que avisa al menú de que otra pantalla quiere volver a él: la lista
 * de la configuración del club en el móvil (#718) vuelve "a la cuenta", y la
 * cuenta del móvil es este menú, no una ruta. */
export const OPEN_ACCOUNT_MENU_EVENT = "seadragons:open-account-menu";

export function requestAccountMenu(): void {
  window.dispatchEvent(new Event(OPEN_ACCOUNT_MENU_EVENT));
}

/** Lo que se queda con el foco al pulsarlo. */
const FOCUSABLE_SELECTOR =
  "a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]";

function canTakeFocus(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest(FOCUSABLE_SELECTOR) !== null
  );
}

function AccountIdentityRow({
  account,
  translate,
}: {
  readonly account: AccountIdentity;
  readonly translate: Translator;
}): React.JSX.Element {
  return (
    <div className="account-menu-identity">
      <MemberAvatar
        fullName={account.fullName}
        photoUrl={null}
        size={AVATAR_SIZE}
        className="account-menu-avatar"
      />
      <div className="account-menu-identity-text">
        <p className="account-menu-name">{account.fullName}</p>
        <p className="account-menu-meta">
          {`${translate(`role.${account.role}`)} · ${account.email}`}
        </p>
      </div>
    </div>
  );
}

function AccountMenuLinks({
  translate,
  canConfigureClub,
  onNavigate,
}: {
  readonly translate: Translator;
  readonly canConfigureClub: boolean;
  readonly onNavigate: () => void;
}): React.JSX.Element {
  const isOnClubSettings = isSectionActive(CLUB_SETTINGS_PATH, usePathname());
  const caret = (
    <span className="account-menu-caret">
      <Icon glyph={CaretRight} />
    </span>
  );
  return (
    <ul className="account-menu-list">
      <li>
        <Link
          href={ACCOUNT_PAGE_PATH}
          className="account-menu-item"
          onClick={onNavigate}
        >
          <Icon glyph={UserCircle} />
          <span className="account-menu-item-label">
            {translate("accountMenu.profile")}
          </span>
          {caret}
        </Link>
      </li>
      {canConfigureClub ? (
        <li>
          <Link
            href={CLUB_SETTINGS_PATH}
            className="account-menu-item"
            aria-current={isOnClubSettings ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon glyph={GearSix} />
            <span className="account-menu-item-label">
              {translate("accountMenu.clubSettings")}
            </span>
            {isOnClubSettings ? (
              <span className="account-menu-here">
                {translate("accountMenu.youAreHere")}
              </span>
            ) : null}
            {caret}
          </Link>
        </li>
      ) : null}
    </ul>
  );
}

function AccountMenuPanel({
  id,
  locale,
  account,
  canConfigureClub,
  headingRef,
  onBack,
  onNavigate,
}: {
  readonly id: string;
  readonly locale: Locale;
  readonly account: AccountIdentity;
  readonly canConfigureClub: boolean;
  readonly headingRef: React.Ref<HTMLHeadingElement>;
  readonly onBack: () => void;
  readonly onNavigate: () => void;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const headingId = `${id}-titulo`;
  return (
    <section id={id} className="account-menu" aria-labelledby={headingId}>
      <div className="account-menu-header">
        <button type="button" className="account-menu-back" onClick={onBack}>
          <Icon glyph={ArrowLeft} />
          <span className="visually-hidden">
            {translate("accountMenu.back")}
          </span>
        </button>
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {translate("accountMenu.title")}
        </h2>
      </div>
      <AccountIdentityRow account={account} translate={translate} />
      <AccountMenuLinks
        translate={translate}
        canConfigureClub={canConfigureClub}
        onNavigate={onNavigate}
      />
      <ThemeChoice translate={translate} />
      <LanguageChoice locale={locale} translate={translate} />
      <div className="account-menu-signout">
        <SignOutButton locale={locale} />
      </div>
    </section>
  );
}

export function AccountMenu({
  locale,
  account,
  canConfigureClub,
}: {
  locale: Locale;
  account: AccountIdentity;
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

  useEffect(() => {
    const open = (): void => setIsOpen(true);
    window.addEventListener(OPEN_ACCOUNT_MENU_EVENT, open);
    return () => window.removeEventListener(OPEN_ACCOUNT_MENU_EVENT, open);
  }, []);

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
          account={account}
          canConfigureClub={canConfigureClub}
          headingRef={headingRef}
          onBack={closeAndReturnFocus}
          onNavigate={close}
        />
      ) : null}
    </div>
  );
}
