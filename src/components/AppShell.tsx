import type { ReactNode } from "react";
import { AccountMenu } from "@/components/AccountMenu";
import { MobileTabBar } from "@/components/MobileTabBar";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { SidebarNav } from "@/components/SidebarNav";
import type { Role } from "@/lib/auth/roles";
import type { Locale } from "@/lib/i18n/locale";

const CLUB_NAME = "Victoria Seadragons";

export function AppShell({
  locale,
  role,
  children,
}: {
  locale: Locale;
  /** El que leyó el servidor: decide qué secciones ofrece la navegación. */
  role: Role;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar-header">
          <span className="app-brand">{CLUB_NAME}</span>
          {/* La campana va fuera del menú de la cuenta (#287): lleva el número
              de avisos sin leer, y dentro de un menú no avisaría de nada. */}
          <div className="app-sidebar-actions">
            <NotificationBell locale={locale} />
            <AccountMenu locale={locale} />
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
