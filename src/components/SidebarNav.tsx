"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/auth/roles";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import {
  getSectionLabel,
  getVisibleSections,
  isSectionActive,
} from "@/lib/navigation";

// Highlighting the active section needs the current route, which Server
// Components cannot read; usePathname() is the documented reason this leaf
// is a Client Component instead of the whole shell. For the same reason it
// can't read the locale cookie itself, so the shell passes the locale down,
// and the role the server read (#213).
export function SidebarNav({
  locale,
  role,
}: {
  locale: Locale;
  role: Role;
}): React.JSX.Element {
  const pathname = usePathname();
  const translate = createTranslator(locale);

  return (
    <nav aria-label={translate("nav.sidebarLabel")} className="app-nav">
      <ul>
        {getVisibleSections(role).map((section) => {
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
