import Link from "next/link";
import type { ReactNode } from "react";
import { AccountIcon } from "@/components/NavIcons";
import { LanguageToggle } from "@/components/LanguageToggle";
import { MobileTabBar } from "@/components/MobileTabBar";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { SidebarNav } from "@/components/SidebarNav";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { Role } from "@/lib/auth/roles";
import { ACCOUNT_PAGE_PATH } from "@/lib/auth/routes";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

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
  const accountLabel = createTranslator(locale)("account.link");
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar-header">
          <span className="app-brand">{CLUB_NAME}</span>
          <div className="app-sidebar-actions">
            <ThemeToggle locale={locale} />
            <LanguageToggle locale={locale} />
            <NotificationBell locale={locale} />
            {/* Un icono, como cerrar sesión: con texto, los controles no
                caben junto al nombre del club a 360px. */}
            <Link
              href={ACCOUNT_PAGE_PATH}
              className="app-header-icon"
              aria-label={accountLabel}
              title={accountLabel}
            >
              <AccountIcon />
            </Link>
            <SignOutButton locale={locale} />
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
