"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import type { ActiveAccess } from "@/lib/auth/session-boundary";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import {
  getMobileLabel,
  getMobileSections,
  getSectionLabel,
  isSectionActive,
} from "@/lib/navigation";
import { NAV_SECTION_ICONS, OverflowIcon } from "@/components/NavIcons";

const OVERFLOW_PANEL_ID = "app-tabbar-overflow";

// Same reason as SidebarNav: usePathname() only exists on the client, and the
// overflow panel needs open/closed state. Both stay in this leaf so AppShell
// remains a Server Component.
export function MobileTabBar({
  locale,
  access,
}: {
  locale: Locale;
  access: ActiveAccess;
}): React.JSX.Element {
  const pathname = usePathname();
  const translate = createTranslator(locale);
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const { primary, overflow } = getMobileSections(access);

  const hasActiveOverflowSection = overflow.some((section) =>
    isSectionActive(section.href, pathname),
  );

  return (
    <nav aria-label={translate("nav.tabBarLabel")} className="app-tabbar">
      <ul
        className="app-tabbar-overflow"
        id={OVERFLOW_PANEL_ID}
        hidden={!isOverflowOpen}
      >
        {overflow.map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              aria-current={
                isSectionActive(section.href, pathname) ? "page" : undefined
              }
            >
              {getSectionLabel(section, translate)}
            </Link>
          </li>
        ))}
      </ul>
      <ul className="app-tabbar-tabs">
        {primary.map((section) => {
          const SectionIcon = NAV_SECTION_ICONS[section.icon];
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={
                  isSectionActive(section.href, pathname) ? "page" : undefined
                }
              >
                <SectionIcon />
                {getMobileLabel(section, translate)}
              </Link>
            </li>
          );
        })}
        {/* Sin nada que desbordar no hay Más: quien no tiene la membresía
            al día cabe entero en las pestañas fijas (#453). */}
        {overflow.length === 0 ? null : (
          <li>
            <button
              type="button"
              aria-controls={OVERFLOW_PANEL_ID}
              aria-expanded={isOverflowOpen}
              // "true", not "page": the current page is inside this group, it is
              // not this control.
              aria-current={hasActiveOverflowSection ? "true" : undefined}
              onClick={() => setIsOverflowOpen((isOpen) => !isOpen)}
            >
              <OverflowIcon />
              {translate("nav.more")}
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}
