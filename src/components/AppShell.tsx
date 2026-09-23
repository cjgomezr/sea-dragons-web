import type { ReactNode } from "react";
import { AccountMenu } from "@/components/AccountMenu";
import { MobileTabBar } from "@/components/MobileTabBar";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { SidebarNav } from "@/components/SidebarNav";
import type { Role } from "@/lib/auth/roles";
import { CLUB_SETTINGS_PATH } from "@/lib/auth/routes";
import { isAllowedForRole } from "@/lib/auth/session-boundary";
import type { ClubBrand } from "@/lib/club/club-brand";
import type { Locale } from "@/lib/i18n/locale";

export function AppShell({
  locale,
  role,
  brand,
  children,
}: {
  locale: Locale;
  /** El que leyó el servidor: decide qué secciones ofrece la navegación. */
  role: Role;
  /** La que leyó el servidor de la base (#292). */
  brand: ClubBrand;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar-header">
          {/* Un nombre largo se recorta con puntos suspensivos: el título lo
              deja leer entero, y el texto sigue completo para un lector de
              pantalla. */}
          <span className="app-brand" title={brand.name}>
            {brand.name}
          </span>
          {/* La campana va fuera del menú de la cuenta (#287): lleva el número
              de avisos sin leer, y dentro de un menú no avisaría de nada. */}
          <div className="app-sidebar-actions">
            <NotificationBell locale={locale} />
            {/* Con la misma regla que la frontera, como la navegación: el
                menú no ofrece lo que la frontera no dejaría abrir. */}
            <AccountMenu
              locale={locale}
              canConfigureClub={isAllowedForRole(CLUB_SETTINGS_PATH, role)}
            />
          </div>
        </div>
        <SidebarNav locale={locale} role={role} />
      </aside>
      <main className="app-main">{children}</main>
      {/* After main on purpose: the bar sits at the bottom of the screen, so
          the tab order should reach it after the content, not before. */}
      <MobileTabBar locale={locale} role={role} />
    </div>
  );
}
