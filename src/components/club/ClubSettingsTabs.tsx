"use client";

import { useRef } from "react";
import { Icon } from "@/components/Icon";
import {
  CLUB_SETTINGS_SECTIONS,
  type ClubSettingsSection,
} from "@/lib/club/club-settings-sections";
import type { Translator } from "@/lib/i18n/translator";
import { CLUB_SETTINGS_SECTION_ICONS } from "./club-settings-section-icons";

/**
 * La barra de pestañas de la configuración del club en escritorio (#718,
 * #1a del handoff de E26): General · Página de inicio de sesión ·
 * Posiciones · Packs de sesiones. Sólo la ve un Admin.
 *
 * Las flechas dan la vuelta al llegar a un extremo, e Inicio y Fin van a la
 * primera y a la última: el patrón de pestañas de WAI-ARIA, que activa la
 * pestaña al enfocarla. Una pestaña con borrador lleva el punto de aviso
 * (#719), y para el lector de pantalla, "Sin guardar".
 */

const LAST_INDEX = CLUB_SETTINGS_SECTIONS.length - 1;

function sectionAt(index: number): ClubSettingsSection {
  const count = CLUB_SETTINGS_SECTIONS.length;
  const section = CLUB_SETTINGS_SECTIONS[(index + count) % count];
  if (section === undefined) {
    throw new RangeError(`No hay sección en el puesto ${index}.`);
  }
  return section;
}

/** La pestaña a la que lleva cada tecla, o `null` si la tecla no mueve. */
function sectionForKey(
  key: string,
  current: ClubSettingsSection,
): ClubSettingsSection | null {
  const index = CLUB_SETTINGS_SECTIONS.indexOf(current);
  switch (key) {
    case "ArrowRight":
      return sectionAt(index + 1);
    case "ArrowLeft":
      return sectionAt(index - 1);
    case "Home":
      return sectionAt(0);
    case "End":
      return sectionAt(LAST_INDEX);
    default:
      return null;
  }
}

export function clubSettingsTabId(
  idPrefix: string,
  section: ClubSettingsSection,
): string {
  return `${idPrefix}-pestana-${section}`;
}

export function clubSettingsPanelId(
  idPrefix: string,
  section: ClubSettingsSection,
): string {
  return `${idPrefix}-panel-${section}`;
}

export function ClubSettingsTabs({
  translate,
  idPrefix,
  activeSection,
  draftSections,
  onSelect,
}: {
  readonly translate: Translator;
  readonly idPrefix: string;
  readonly activeSection: ClubSettingsSection;
  readonly draftSections: ReadonlySet<ClubSettingsSection>;
  readonly onSelect: (section: ClubSettingsSection) => void;
}): React.JSX.Element {
  const tabRefs = useRef<
    Partial<Record<ClubSettingsSection, HTMLButtonElement>>
  >({});

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const next = sectionForKey(event.key, activeSection);
    if (next === null) {
      return;
    }
    event.preventDefault();
    onSelect(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div
      className="club-settings-tabs"
      role="tablist"
      aria-label={translate("clubSettings.sections.label")}
      onKeyDown={handleKeyDown}
    >
      {CLUB_SETTINGS_SECTIONS.map((section) => {
        const isActive = section === activeSection;
        return (
          <button
            key={section}
            ref={(element) => {
              tabRefs.current[section] = element ?? undefined;
            }}
            type="button"
            role="tab"
            id={clubSettingsTabId(idPrefix, section)}
            className="club-settings-tab"
            aria-selected={isActive}
            aria-controls={clubSettingsPanelId(idPrefix, section)}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(section)}
          >
            <Icon glyph={CLUB_SETTINGS_SECTION_ICONS[section]} />
            {translate(`clubSettings.sections.${section}`)}
            {draftSections.has(section) ? (
              <>
                <span className="club-draft-dot" aria-hidden="true" />{" "}
                <span className="visually-hidden">
                  {translate("clubSettings.draft.marker")}
                </span>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
