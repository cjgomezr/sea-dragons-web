import type { ReactNode } from "react";
import { SidebarNav } from "@/components/SidebarNav";
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
          <ThemeToggle />
        </div>
        <SidebarNav />
      </aside>
      <main className="app-main">{children}</main>
    </div>
  );
}
