"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import {
  MOBILE_OVERFLOW_SECTIONS,
  MOBILE_PRIMARY_SECTIONS,
  getMobileLabel,
  isSectionActive,
} from "@/lib/navigation";
import { NAV_SECTION_ICONS, OverflowIcon } from "@/components/NavIcons";

const OVERFLOW_PANEL_ID = "app-tabbar-overflow";

// Same reason as SidebarNav: usePathname() only exists on the client, and the
// overflow panel needs open/closed state. Both stay in this leaf so AppShell
// remains a Server Component.
export function MobileTabBar(): React.JSX.Element {
  const pathname = usePathname();
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);

  const hasActiveOverflowSection = MOBILE_OVERFLOW_SECTIONS.some((section) =>
    isSectionActive(section.href, pathname),
  );

  return (
    <nav aria-label="Secciones" className="app-tabbar">
      <ul
        className="app-tabbar-overflow"
        id={OVERFLOW_PANEL_ID}
        hidden={!isOverflowOpen}
      >
        {MOBILE_OVERFLOW_SECTIONS.map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              aria-current={
                isSectionActive(section.href, pathname) ? "page" : undefined
              }
            >
              {getMobileLabel(section)}
            </Link>
          </li>
        ))}
      </ul>
      <ul className="app-tabbar-tabs">
        {MOBILE_PRIMARY_SECTIONS.map((section) => {
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
                {getMobileLabel(section)}
              </Link>
            </li>
          );
        })}
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
            Más
          </button>
        </li>
      </ul>
    </nav>
  );
}
