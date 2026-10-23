import Link from "next/link";
import type { ReactNode } from "react";
import {
  AccountMenu,
  type AccountIdentity,
  type AccountMenuTrigger,
} from "@/components/AccountMenu";
import { ClubBrandMark } from "@/components/ClubBrandMark";
import { ClubNameProvider } from "@/components/club/ClubNameProvider";
import { FailedPaymentNotice } from "@/components/FailedPaymentNotice";
import { MobileTabBar } from "@/components/MobileTabBar";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import { MobileSearch } from "@/components/search/MobileSearch";
import { ScreenOnly } from "@/components/ScreenOnly";
import { SidebarNav } from "@/components/SidebarNav";
import {
  CLUB_SETTINGS_PATH,
  DASHBOARD_PATH,
  SEARCH_API_PATH,
} from "@/lib/auth/routes";
import {
  type ActiveAccess,
  isAllowedForAccess,
} from "@/lib/auth/session-boundary";
import type { ClubBrand } from "@/lib/club/club-brand";
import type { Locale } from "@/lib/i18n/locale";
import type { FailedPaymentAlert } from "@/lib/membership/failed-payment-alert";

/** La campana y la cuenta, los dos controles que en el móvil van en la
 * cabecera y en escritorio en la barra de arriba (#717). La campana va fuera
 * del menú de la cuenta (#287): lleva el número de avisos sin leer, y dentro
 * de un menú no avisaría de nada. */
function HeaderActions({
  locale,
  account,
  trigger,
  canConfigureClub,
}: {
  locale: Locale;
  account: AccountIdentity;
  trigger: AccountMenuTrigger;
  canConfigureClub: boolean;
}): React.JSX.Element {
  return (
    <>
      <NotificationBell locale={locale} />
      <AccountMenu
        locale={locale}
        account={account}
        trigger={trigger}
        canConfigureClub={canConfigureClub}
      />
    </>
  );
}

export function AppShell({
  locale,
  access,
  viewerId,
  account,
  brand,
  failedPayment,
  children,
}: {
  locale: Locale;
  /** El rol y la membresía que leyó el servidor: deciden qué secciones
   * ofrece la navegación (#213, #453). */
  access: ActiveAccess;
  /** Quien tiene la sesión, leído en el servidor: la búsqueda lo lleva a su
   * perfil cuando se encuentra a sí mismo (#427). */
  viewerId: string;
  /** El nombre, el correo y la foto de quien mira, para el menú de la cuenta
   * (#716) y su botón (#717). */
  account: Omit<AccountIdentity, "role">;
  /** La que leyó el servidor de la base (#292). */
  brand: ClubBrand;
  /** El cobro fallido de quien mira, decidido en el servidor (#474); nulo
   * si no tiene ninguno pendiente. */
  failedPayment: FailedPaymentAlert | null;
  children: ReactNode;
}): React.JSX.Element {
  const viewer = { userId: viewerId, role: access.role };
  // La búsqueda encuentra socios y noticias de todo el club, y la frontera
  // se la cierra a quien no tiene la membresía al día (#453).
  const canSearch = isAllowedForAccess(SEARCH_API_PATH, access);
  // Con la misma regla que la frontera, como la navegación: el menú no ofrece
  // lo que la frontera no dejaría abrir.
  const headerActions = {
    locale,
    account: { ...account, role: access.role },
    canConfigureClub: isAllowedForAccess(CLUB_SETTINGS_PATH, access),
  };
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar-header">
          {/* Un nombre largo se recorta: el título lo deja leer entero, y el
              texto sigue completo para un lector de pantalla. La marca lleva
              al inicio, como en casi cualquier aplicación: en el móvil era la
              única forma rápida de volver desde el perfil o el club. */}
          <Link href={DASHBOARD_PATH} className="app-brand-lockup">
            {/* Sin logo, la cabecera sigue siendo sólo el nombre (#295). El
                logo va sin texto alternativo porque el nombre ya está al lado:
                con él, un lector de pantalla leería el club dos veces (#352). */}
            <ClubBrandMark logoUrl={brand.logoUrl} logoAlt="" fallback={null} />
            <span className="app-brand" title={brand.name}>
              {brand.name}
            </span>
          </Link>
          {/* Sólo en el móvil (#717): en escritorio la cabecera de la barra
              lateral es la marca, y la lupa no hace falta porque el cuadro
              ya está en la barra de arriba (#427). */}
          <div className="app-sidebar-actions">
            <ScreenOnly screen="phone">
              {canSearch ? (
                <MobileSearch locale={locale} viewer={viewer} />
              ) : null}
              <HeaderActions {...headerActions} trigger="icon" />
            </ScreenOnly>
          </div>
        </div>
        <SidebarNav locale={locale} access={access} />
      </aside>
      <div className="app-content">
        {/* La barra de arriba de escritorio: el cuadro de búsqueda del mockup
            del panel (#427) a la izquierda, y la campana y la cuenta a la
            derecha (#717). En el móvil no se ve: la búsqueda la abre la lupa
            de la cabecera, y los dos botones viven en ella. */}
        <div className="app-topbar">
          {canSearch ? (
            <div className="app-topbar-search" role="search">
              <GlobalSearch locale={locale} viewer={viewer} layout="bar" />
            </div>
          ) : null}
          <div className="app-topbar-actions">
            <ScreenOnly screen="desktop">
              <HeaderActions {...headerActions} trigger="avatar" />
            </ScreenOnly>
          </div>
        </div>
        {/* Arriba del contenido de cualquier pantalla y fuera de la
            navegación, para no taparla (#474). */}
        {failedPayment === null ? null : (
          <FailedPaymentNotice
            locale={locale}
            failedAt={failedPayment.failedAt?.toISOString() ?? null}
          />
        )}
        <main className="app-main">
          <ClubNameProvider name={brand.name}>{children}</ClubNameProvider>
        </main>
      </div>
      {/* After main on purpose: the bar sits at the bottom of the screen, so
          the tab order should reach it after the content, not before. */}
      <MobileTabBar locale={locale} access={access} />
    </div>
  );
}
