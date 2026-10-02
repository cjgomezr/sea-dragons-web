import type { ReactNode } from "react";
import { AccountMenu } from "@/components/AccountMenu";
import { ClubBrandMark } from "@/components/ClubBrandMark";
import { MobileTabBar } from "@/components/MobileTabBar";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import { MobileSearch } from "@/components/search/MobileSearch";
import { SidebarNav } from "@/components/SidebarNav";
import { CLUB_SETTINGS_PATH, SEARCH_API_PATH } from "@/lib/auth/routes";
import {
  type ActiveAccess,
  isAllowedForAccess,
} from "@/lib/auth/session-boundary";
import type { ClubBrand } from "@/lib/club/club-brand";
import type { Locale } from "@/lib/i18n/locale";

export function AppShell({
  locale,
  access,
  viewerId,
  brand,
  children,
}: {
  locale: Locale;
  /** El rol y la membresía que leyó el servidor: deciden qué secciones
   * ofrece la navegación (#213, #453). */
  access: ActiveAccess;
  /** Quien tiene la sesión, leído en el servidor: la búsqueda lo lleva a su
   * perfil cuando se encuentra a sí mismo (#427). */
  viewerId: string;
  /** La que leyó el servidor de la base (#292). */
  brand: ClubBrand;
  children: ReactNode;
}): React.JSX.Element {
  const viewer = { userId: viewerId, role: access.role };
  // La búsqueda encuentra socios y noticias de todo el club, y la frontera
  // se la cierra a quien no tiene la membresía al día (#453).
  const canSearch = isAllowedForAccess(SEARCH_API_PATH, access);
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar-header">
          {/* Un nombre largo se recorta: el título lo deja leer entero, y el
              texto sigue completo para un lector de pantalla. */}
          <div className="app-brand-lockup">
            {/* Sin logo, la cabecera sigue siendo sólo el nombre (#295). El
                logo va sin texto alternativo porque el nombre ya está al lado:
                con él, un lector de pantalla leería el club dos veces (#352). */}
            <ClubBrandMark logoUrl={brand.logoUrl} logoAlt="" fallback={null} />
            <span className="app-brand" title={brand.name}>
              {brand.name}
            </span>
          </div>
          {/* La campana va fuera del menú de la cuenta (#287): lleva el número
              de avisos sin leer, y dentro de un menú no avisaría de nada. */}
          <div className="app-sidebar-actions">
            {/* La lupa sólo se ve en el móvil (#427): en escritorio el cuadro
                ya está en la barra de arriba del contenido. */}
            {canSearch ? (
              <MobileSearch locale={locale} viewer={viewer} />
            ) : null}
            <NotificationBell locale={locale} />
            {/* Con la misma regla que la frontera, como la navegación: el
                menú no ofrece lo que la frontera no dejaría abrir. */}
            <AccountMenu
              locale={locale}
              canConfigureClub={isAllowedForAccess(CLUB_SETTINGS_PATH, access)}
            />
          </div>
        </div>
        <SidebarNav locale={locale} access={access} />
      </aside>
      <div className="app-content">
        {/* El cuadro de búsqueda del mockup del panel (#427). En el móvil no
            se pinta: lo abre la lupa de la cabecera a pantalla completa. */}
        {canSearch ? (
          <div className="app-topbar" role="search">
            <GlobalSearch locale={locale} viewer={viewer} layout="bar" />
          </div>
        ) : null}
        <main className="app-main">{children}</main>
      </div>
      {/* After main on purpose: the bar sits at the bottom of the screen, so
          the tab order should reach it after the content, not before. */}
      <MobileTabBar locale={locale} access={access} />
    </div>
  );
}
