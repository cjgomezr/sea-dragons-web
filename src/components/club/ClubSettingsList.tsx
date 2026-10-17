"use client";

import { ArrowLeft } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { useEffect, useId, useRef, useState } from "react";
import { requestAccountMenu } from "@/components/AccountMenu";
import { ClubBrandMark } from "@/components/ClubBrandMark";
import { Icon } from "@/components/Icon";
import type { ClubBrand } from "@/lib/club/club-brand";
import type { ClubSettings } from "@/lib/club/club-settings";
import {
  CLUB_SETTINGS_SECTIONS,
  type ClubSettingsSection,
} from "@/lib/club/club-settings-sections";
import {
  summarizeGeneral,
  summarizePositions,
  summarizeSessionPacks,
  summarizeSignInTexts,
} from "@/lib/club/club-settings-summaries";
import type { ManagedPositions } from "@/lib/club/manage-club-positions";
import type { SignInTexts } from "@/lib/club/sign-in-texts";
import type { Translator } from "@/lib/i18n/translator";
import { loadManagedPositions } from "./club-positions-admin-client";
import { loadSessionPacks } from "./club-session-packs-client";
import { loadClubSettings } from "./club-settings-client";
import { loadSignInTexts } from "./club-sign-in-texts-client";
import { CLUB_SETTINGS_SECTION_ICONS } from "./club-settings-section-icons";

/**
 * La configuración del club en el móvil sin sección abierta (#718, #3a del
 * handoff de E26): la fila del club y una tarjeta con las cuatro secciones,
 * cada una con un resumen de lo que tiene guardado. Tocar una la abre. Una
 * con borrador dice "● Sin guardar" junto a su título (#719).
 */

export type ClubIdentity = Pick<ClubBrand, "name" | "initials" | "logoUrl">;

/** Lo que resume cada fila, o `null` mientras no llega. */
type ListData = {
  readonly settings: ClubSettings | null;
  readonly signInTexts: SignInTexts | null;
  readonly positions: ManagedPositions | null;
  readonly packSizes: readonly number[] | null;
};

const NO_LIST_DATA: ListData = {
  settings: null,
  signInTexts: null,
  positions: null,
  packSizes: null,
};

/** Pide lo de las cuatro secciones a la vez, cada una por su lado. Una que
 * falla se queda sin resumen y nada más: su error lo enseña la sección al
 * abrirla, que es donde se puede reintentar. */
function useListData(): ListData {
  const [data, setData] = useState<ListData>(NO_LIST_DATA);
  useEffect(() => {
    let isCurrent = true;
    function keep(patch: Partial<ListData>): void {
      if (isCurrent) {
        setData((current) => ({ ...current, ...patch }));
      }
    }
    void loadClubSettings().then((read) => {
      if (read.kind === "loaded") keep({ settings: read.settings });
    });
    void loadSignInTexts().then((read) => {
      if (read.kind === "loaded") keep({ signInTexts: read.texts });
    });
    void loadManagedPositions().then((read) => {
      if (read.kind === "loaded") keep({ positions: read.positions });
    });
    void loadSessionPacks().then((read) => {
      if (read.kind === "loaded") keep({ packSizes: read.packs.sizes });
    });
    return () => {
      isCurrent = false;
    };
  }, []);
  return data;
}

function summarizeSection(
  translate: Translator,
  section: ClubSettingsSection,
  data: ListData,
): string | null {
  switch (section) {
    case "general":
      return data.settings === null
        ? null
        : summarizeGeneral(translate, data.settings);
    case "sign-in":
      return data.signInTexts === null
        ? null
        : summarizeSignInTexts(translate, data.signInTexts);
    case "positions":
      return data.positions === null
        ? null
        : summarizePositions(translate, data.positions);
    case "packs":
      return data.packSizes === null
        ? null
        : summarizeSessionPacks(translate, data.packSizes);
  }
}

function ClubRow({
  translate,
  club,
}: {
  readonly translate: Translator;
  readonly club: ClubIdentity;
}): React.JSX.Element {
  return (
    <div className="club-settings-club-row">
      {/* El nombre va al lado: el logo no repite el texto (#352). */}
      <ClubBrandMark
        logoUrl={club.logoUrl}
        logoAlt=""
        fallback={
          <span className="auth-brand-mark" aria-hidden="true">
            {club.initials}
          </span>
        }
      />
      <div>
        <p className="club-settings-club-name">{club.name}</p>
        <p className="club-settings-club-note">
          {translate("clubSettings.list.adminsOnly")}
        </p>
      </div>
    </div>
  );
}

export function ClubSettingsList({
  translate,
  club,
  draftSections,
  shouldFocusTitle,
  onOpen,
}: {
  readonly translate: Translator;
  readonly club: ClubIdentity;
  readonly draftSections: ReadonlySet<ClubSettingsSection>;
  /** Si se llega desde una sección: el botón pulsado ya no existe y el foco
   * pasa al título, en vez de perderse en la página. */
  readonly shouldFocusTitle: boolean;
  readonly onOpen: (section: ClubSettingsSection) => void;
}): React.JSX.Element {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const data = useListData();

  useEffect(() => {
    if (shouldFocusTitle) {
      titleRef.current?.focus();
    }
  }, [shouldFocusTitle]);

  const backLabel = translate("clubSettings.list.backToAccount");
  return (
    <section className="club-settings-list-screen" aria-labelledby={titleId}>
      <header className="club-settings-mobile-header">
        <button
          type="button"
          className="directory-back"
          aria-label={backLabel}
          title={backLabel}
          onClick={requestAccountMenu}
        >
          <Icon glyph={ArrowLeft} />
        </button>
        <h1 id={titleId} ref={titleRef} tabIndex={-1}>
          {translate("clubSettings.title")}
        </h1>
      </header>
      <ClubRow translate={translate} club={club} />
      <ul className="club-settings-list">
        {CLUB_SETTINGS_SECTIONS.map((section) => (
          <li key={section}>
            <button
              type="button"
              className="club-settings-list-row"
              onClick={() => onOpen(section)}
            >
              <span className="club-settings-list-icon">
                <Icon glyph={CLUB_SETTINGS_SECTION_ICONS[section]} />
              </span>
              <span className="club-settings-list-text">
                <span className="club-settings-list-title">
                  {translate(`clubSettings.sections.${section}`)}
                  {draftSections.has(section) ? (
                    <span className="club-settings-list-draft">
                      {" "}
                      <span className="club-draft-dot" aria-hidden="true" />
                      {translate("clubSettings.draft.marker")}
                    </span>
                  ) : null}
                </span>
                <span className="club-settings-list-summary">
                  {summarizeSection(translate, section, data)}
                </span>
              </span>
              <span className="club-settings-list-caret">
                <Icon glyph={CaretRight} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
