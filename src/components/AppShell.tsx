import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

const CLUB_NAME = "Victoria Seadragons";

export function AppShell({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-brand">{CLUB_NAME}</span>
        <nav aria-label="Principal">
          <ul className="app-nav">
            <li>
              <Link href="/" aria-current="page">
                Inicio
              </Link>
            </li>
          </ul>
        </nav>
        <ThemeToggle />
      </header>
      <main className="app-main">{children}</main>
      <footer className="app-footer">
        <p>Rugby subacuático · Melbourne</p>
      </footer>
    </div>
  );
}
