"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_SECTIONS, isSectionActive } from "@/lib/navigation";

// Highlighting the active section needs the current route, which Server
// Components cannot read; usePathname() is the documented reason this leaf
// is a Client Component instead of the whole shell.
export function SidebarNav(): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav aria-label="Principal" className="app-nav">
      <ul>
        {NAV_SECTIONS.map((section) => {
          const isCurrent = isSectionActive(section.href, pathname);
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={isCurrent ? "page" : undefined}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
