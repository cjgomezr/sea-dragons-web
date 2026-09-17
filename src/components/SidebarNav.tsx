"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import {
  NAV_SECTIONS,
  getSectionLabel,
  isSectionActive,
} from "@/lib/navigation";

// Highlighting the active section needs the current route, which Server
// Components cannot read; usePathname() is the documented reason this leaf
// is a Client Component instead of the whole shell. For the same reason it
// can't read the locale cookie itself, so the shell passes the locale down.
export function SidebarNav({ locale }: { locale: Locale }): React.JSX.Element {
  const pathname = usePathname();
  const translate = createTranslator(locale);

  return (
    <nav aria-label={translate("nav.sidebarLabel")} className="app-nav">
      <ul>
        {NAV_SECTIONS.map((section) => {
          const isCurrent = isSectionActive(section.href, pathname);
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={isCurrent ? "page" : undefined}
              >
                {getSectionLabel(section, translate)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
