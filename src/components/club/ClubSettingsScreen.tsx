"use client";

import { CaretLeft } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useIsPhone } from "@/components/use-is-phone";
import {
  type ClubDraftSection,
  CLUB_SETTINGS_SECTIONS,
  type ClubSettingsSection,
} from "@/lib/club/club-settings-sections";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator, type Translator } from "@/lib/i18n/translator";
import {
  type ClubSettingsRead,
  describeClubSettingsFailure,
  loadClubSettings,
} from "./club-settings-client";
import { type ClubIdentity, ClubSettingsList } from "./ClubSettingsList";
import { ClubPositionsSection } from "./ClubPositionsSection";
import { ClubSessionPacksSection } from "./ClubSessionPacksSection";
import { ClubSettingsForm } from "./ClubSettingsForm";
import {
  ClubSettingsTabs,
  clubSettingsPanelId,
  clubSettingsTabId,
} from "./ClubSettingsTabs";
import { ClubSignInTextsSection } from "./ClubSignInTextsSection";
import { useClubSettingsSection } from "./use-club-settings-section";
import { useConfirmLeaving } from "./use-confirm-leaving";

/**
 * La configuración del club (#296, RF-6 del PRD de E18a), que se abre desde
 * el menú de la cuenta. Un Admin la ve entera, dividida en secciones (#718,
 * RF-1 del PRD de E26): pestañas en escritorio y, en el móvil, una lista que
 * abre cada sección en su pantalla. El Committee sólo ve los packs de
 * sesiones (#469, FR-080), que es lo único que la matriz le deja cambiar,
 * sin pestañas ni lista (D8).
 *
 * General, Inicio de sesión y Packs juntan un borrador (#719, D10 y D11):
 * su pestaña o su fila lo marca, y salir de la página con él pregunta.
 *
 * La frontera ya mandó al panel a quien no es ninguno de los dos; si alguien
 * deja de serlo con la pantalla abierta, el 403 del endpoint lo dice aquí. Es
 * de cliente porque lee y guarda por la API v1, la misma que usará la
 * aplicación nativa de Release 2 (CON-002).
 */

type ScreenState = { readonly kind: "loading" } | ClubSettingsRead;

type DraftReporters = Readonly<
  Record<ClubDraftSection, (hasDraft: boolean) => void>
>;

/** Las secciones con borrador, y con qué avisa cada una. Los avisos no
 * cambian entre pintados: cada sección los usa en un efecto. */
function useDraftSections(): readonly [
  ReadonlySet<ClubSettingsSection>,
  DraftReporters,
] {
  const [sections, setSections] = useState<ReadonlySet<ClubSettingsSection>>(
    () => new Set(),
  );
  const reporters = useMemo(() => {
    const reportFor =
      (section: ClubDraftSection) =>
      (hasDraft: boolean): void =>
        setSections((current) => {
          if (current.has(section) === hasDraft) {
            return current;
          }
          const next = new Set(current);
          if (hasDraft) {
            next.add(section);
          } else {
            next.delete(section);
          }
          return next;
        });
    return {
      general: reportFor("general"),
      "sign-in": reportFor("sign-in"),
      packs: reportFor("packs"),
    };
  }, []);
  return [sections, reporters];
}

/** General: la identidad del club. Carga lo suyo y enseña su propio error,
 * sin tocar las demás secciones. */
function GeneralSection({
  translate,
  onHasDraftChange,
}: {
  translate: Translator;
  onHasDraftChange: (hasDraft: boolean) => void;
}): React.JSX.Element {
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadClubSettings().then((outcome) => {
      if (isCurrent) {
        setState(outcome);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [reloads]);

  function reload(): void {
    setState({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  switch (state.kind) {
    case "loading":
      return <p className="admin-empty">{translate("clubSettings.loading")}</p>;
    case "failed":
      return (
        <div className="admin-load-failure">
          <p className="auth-error" role="alert">
            {describeClubSettingsFailure(translate, state)}
          </p>
          <button type="button" className="auth-submit" onClick={reload}>
            {translate("directory.retry")}
          </button>
        </div>
      );
    case "loaded":
      return (
        <ClubSettingsForm
          // Lo último que se cargó empieza de cero: sin esto, el borrador
          // que chocó con el cambio de otro Admin seguiría a la vista.
          key={reloads}
          translate={translate}
          settings={state.settings}
          onReloadRequested={reload}
          onHasDraftChange={onHasDraftChange}
        />
      );
  }
}

function SectionContent({
  section,
  locale,
  translate,
  club,
  reporters,
}: {
  section: ClubSettingsSection;
  locale: Locale;
  translate: Translator;
  club: ClubIdentity;
  reporters: DraftReporters;
}): React.JSX.Element {
  switch (section) {
    case "general":
      return (
        <GeneralSection
          translate={translate}
          onHasDraftChange={reporters.general}
        />
      );
    case "sign-in":
      return (
        <ClubSignInTextsSection
          locale={locale}
          translate={translate}
          club={club}
          onHasDraftChange={reporters["sign-in"]}
        />
      );
    case "positions":
      // Cada cambio de las posiciones se guarda en el acto (#300).
      return <ClubPositionsSection locale={locale} translate={translate} />;
    case "packs":
      return (
        <ClubSessionPacksSection
          translate={translate}
          onHasDraftChange={reporters.packs}
        />
      );
  }
}

/** Las secciones que ya se abrieron. Se quedan montadas y sólo se esconde
 * la inactiva, como en Pagos: volver a una no la pide otra vez ni pierde lo
 * que se estaba escribiendo. Las que no se abrieron no piden nada. */
function useOpenedSections(
  active: ClubSettingsSection | null,
): ReadonlySet<ClubSettingsSection> {
  const [opened, setOpened] = useState<ReadonlySet<ClubSettingsSection>>(
    () => new Set(active === null ? [] : [active]),
  );
  if (active !== null && !opened.has(active)) {
    setOpened(new Set([...opened, active]));
  }
  return opened;
}

function DesktopHeader({
  translate,
}: {
  translate: Translator;
}): React.JSX.Element {
  return (
    <header className="member-record-header">
      <h1 className="club-settings-title">{translate("clubSettings.title")}</h1>
      <p className="app-lead">{translate("clubSettings.lead")}</p>
    </header>
  );
}

/** La cabecera de una sección abierta en el móvil (#3b): "‹ Configuración"
 * vuelve a la lista y el título es el de la sección. */
function PhoneSectionHeader({
  translate,
  section,
  shouldFocusTitle,
  onBack,
}: {
  translate: Translator;
  section: ClubSettingsSection;
  /** Si se llega desde la lista: la fila pulsada ya no existe. */
  shouldFocusTitle: boolean;
  onBack: () => void;
}): React.JSX.Element {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (shouldFocusTitle) {
      titleRef.current?.focus();
    }
  }, [shouldFocusTitle, section]);
  return (
    <header className="club-settings-mobile-header club-settings-section-header">
      <button
        type="button"
        className="club-settings-back-to-list"
        onClick={onBack}
      >
        <Icon glyph={CaretLeft} />
        {translate("clubSettings.list.backToList")}
      </button>
      <h1 ref={titleRef} tabIndex={-1}>
        {translate(`clubSettings.sections.${section}`)}
      </h1>
    </header>
  );
}

/** Lo que hace de cada sección un panel de pestaña en escritorio. En el
 * móvil no hay pestañas que lo nombren, y un panel sin pestaña no es un
 * panel. */
function panelAttributes(
  idPrefix: string,
  section: ClubSettingsSection,
  isPhone: boolean,
): React.HTMLAttributes<HTMLDivElement> {
  if (isPhone) {
    return {};
  }
  return {
    role: "tabpanel",
    "aria-labelledby": clubSettingsTabId(idPrefix, section),
    tabIndex: 0,
  };
}

function AdminClubSettings({
  locale,
  translate,
  club,
  draftSections,
  reporters,
}: {
  locale: Locale;
  translate: Translator;
  club: ClubIdentity;
  draftSections: ReadonlySet<ClubSettingsSection>;
  reporters: DraftReporters;
}): React.JSX.Element {
  const idPrefix = useId();
  const isPhone = useIsPhone();
  const { requested, select } = useClubSettingsSection();
  const [hasNavigated, setHasNavigated] = useState(false);
  const isListOpen = isPhone && requested === null;
  // En escritorio no hay lista: sin sección pedida se abre General (D9).
  const active = isListOpen ? null : (requested ?? "general");
  const opened = useOpenedSections(active);

  function navigate(section: ClubSettingsSection | null): void {
    setHasNavigated(true);
    select(section);
  }

  return (
    <>
      {active === null ? (
        <ClubSettingsList
          translate={translate}
          club={club}
          draftSections={draftSections}
          shouldFocusTitle={hasNavigated}
          onOpen={navigate}
        />
      ) : isPhone ? (
        <PhoneSectionHeader
          translate={translate}
          section={active}
          shouldFocusTitle={hasNavigated}
          onBack={() => navigate(null)}
        />
      ) : (
        <>
          <DesktopHeader translate={translate} />
          <ClubSettingsTabs
            translate={translate}
            idPrefix={idPrefix}
            activeSection={active}
            draftSections={draftSections}
            onSelect={select}
          />
        </>
      )}
      {CLUB_SETTINGS_SECTIONS.map((section) => (
        <div
          key={section}
          id={clubSettingsPanelId(idPrefix, section)}
          className="club-settings-panel"
          hidden={section !== active}
          {...panelAttributes(idPrefix, section, isPhone)}
        >
          {opened.has(section) ? (
            <SectionContent
              section={section}
              locale={locale}
              translate={translate}
              club={club}
              reporters={reporters}
            />
          ) : null}
        </div>
      ))}
    </>
  );
}

export function ClubSettingsScreen({
  locale,
  canManageClub,
  club,
}: {
  locale: Locale;
  /** Si quien la abre es Admin. Si no, sólo puede configurar los packs. */
  canManageClub: boolean;
  /** El nombre y la marca de la fila del club en la lista del móvil. */
  club: ClubIdentity;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [draftSections, reporters] = useDraftSections();
  useConfirmLeaving(
    draftSections.size > 0,
    translate("clubSettings.draft.leaveQuestion"),
  );
  return (
    <div className="club-settings">
      {canManageClub ? (
        <AdminClubSettings
          locale={locale}
          translate={translate}
          club={club}
          draftSections={draftSections}
          reporters={reporters}
        />
      ) : (
        <>
          {/* Al Committee le basta la entradilla de la sección de los packs:
              la de la pantalla habla de lo que sólo cambia el Admin. */}
          <header className="member-record-header">
            <h1 className="club-settings-title">
              {translate("clubSettings.title")}
            </h1>
          </header>
          <ClubSessionPacksSection
            translate={translate}
            onHasDraftChange={reporters.packs}
          />
        </>
      )}
    </div>
  );
}
