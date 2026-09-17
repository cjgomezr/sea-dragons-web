import type { ReactNode } from "react";
import { LanguageToggle } from "@/components/LanguageToggle";
import { MobileTabBar } from "@/components/MobileTabBar";
import { SidebarNav } from "@/components/SidebarNav";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { Locale } from "@/lib/i18n/locale";

const CLUB_NAME = "Victoria Seadragons";

export function AppShell({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar-header">
          <span className="app-brand">{CLUB_NAME}</span>
          <div className="app-sidebar-actions">
            <ThemeToggle locale={locale} />
            <LanguageToggle locale={locale} />
            <SignOutButton locale={locale} />
          </div>
        </div>
        <SidebarNav locale={locale} />
      </aside>
      <main className="app-main">{children}</main>
      {/* After main on purpose: the bar sits at the bottom of the screen, so
          the tab order should reach it after the content, not before. */}
      <MobileTabBar locale={locale} />
    </div>
  );
}
