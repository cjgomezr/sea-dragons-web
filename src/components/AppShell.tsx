import type { ReactNode } from "react";
import { MobileTabBar } from "@/components/MobileTabBar";
import { SidebarNav } from "@/components/SidebarNav";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { ThemeToggle } from "@/components/ThemeToggle";

const CLUB_NAME = "Victoria Seadragons";

export function AppShell({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar-header">
          <span className="app-brand">{CLUB_NAME}</span>
          <div className="app-sidebar-actions">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
        <SidebarNav />
      </aside>
      <main className="app-main">{children}</main>
      {/* After main on purpose: the bar sits at the bottom of the screen, so
          the tab order should reach it after the content, not before. */}
      <MobileTabBar />
    </div>
  );
}
