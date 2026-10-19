"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useIsPhone } from "@/components/use-is-phone";
import { normalizeAccentInput } from "@/lib/club/accent-color";
import { deriveInitials } from "@/lib/club/club-brand";
import {
  type ClubIdentity,
  type ClubIdentityField,
  type ClubSettings,
  type ClubSettingsIssue,
  type ClubSettingsIssueCode,
  findClubSettingsIssues,
  isSameClubIdentity,
} from "@/lib/club/club-settings";
import type { Translator } from "@/lib/i18n/translator";
import {
  describeClubSettingsFailure,
  describeClubSettingsIssue,
  isSettingsConflict,
  readIssueCode,
  saveClubSettings,
} from "./club-settings-client";
import { accentPreviewStyleOf } from "./accent-preview-style";
import { ClubAccentField } from "./ClubAccentField";
import { ClubGeneralPreview } from "./ClubGeneralPreview";
import { ClubIdentityFields, IDENTITY_HEADING_ID } from "./ClubIdentityFields";
import { ClubLogoField } from "./ClubLogoField";
import { ClubSeasonField } from "./ClubSeasonField";
import { SavedNotice, UnsavedChangesBar } from "./ClubUnsavedChangesBar";
import {
  type ClubDraft,
  type ClubDraftStatus,
  type DraftSaveOutcome,
  useClubDraft,
} from "./use-club-draft";

/**
 * El formulario de la configuración del club (#296). Sigue a la ficha del
 * miembro (`MemberRecordForm`): da un cambio por hecho sólo cuando el servidor
 * lo confirma, y entonces enseña lo que el servidor guardó. Se guarda con la
 * barra de cambios sin guardar (#719), que sólo sale con un borrador. Desde
 * #720 es la pestaña General del handoff de E26: IDENTIDAD y MARCA a la
 * izquierda y la vista previa a la derecha; en el móvil, el logo arriba y la
 * vista previa debajo. Desde #744, TEMPORADA va debajo de MARCA.
 *
 * Cada guardado lleva lo que el Admin tenía delante. Si otro Admin guardó
 * entretanto, el servidor responde 409 y la pantalla ofrece cargar lo último
 * en vez de pisarlo. Tras guardar se refresca la página en el servidor, que
 * es lo que redibuja la cabecera con el nombre nuevo.
 */

/** Lo que hay en los controles. Unas iniciales vacías y un inicio de
 * temporada vacío se mandan como null, y el acento se manda como lo guarda
 * la base, escriba lo que escriba el Admin. */
type Draft = {
  readonly name: string;
  readonly initials: string;
  readonly accentColor: string;
  readonly seasonStartsOn: string;
};

const FIELD_OF_ISSUE: Readonly<
  Record<ClubSettingsIssueCode, ClubIdentityField>
> = {
  name_required: "name",
  name_too_long: "name",
  initials_too_long: "initials",
  accent_color_invalid: "accentColor",
  accent_color_no_readable_text: "accentColor",
  season_starts_on_invalid: "seasonStartsOn",
};

function toDraft(settings: ClubSettings): Draft {
  return {
    name: settings.name,
    initials: settings.initials ?? "",
    accentColor: settings.accentColor.toUpperCase(),
    seasonStartsOn: settings.seasonStartsOn ?? "",
  };
}

function toIdentity(draft: Draft): ClubIdentity {
  return {
    name: draft.name,
    initials: draft.initials.trim() === "" ? null : draft.initials,
    accentColor: normalizeAccentInput(draft.accentColor),
    seasonStartsOn: draft.seasonStartsOn === "" ? null : draft.seasonStartsOn,
  };
}

function identityOf(settings: ClubSettings): ClubIdentity {
  return {
    name: settings.name,
    initials: settings.initials,
    accentColor: settings.accentColor,
    seasonStartsOn: settings.seasonStartsOn,
  };
}

function isSameDraft(draft: Draft, saved: Draft): boolean {
  return isSameClubIdentity(toIdentity(draft), toIdentity(saved));
}

/** Los avisos de campo del último envío que el servidor rechazó por uno. */
function serverIssuesOf(status: ClubDraftStatus): readonly ClubSettingsIssue[] {
  if (status.kind !== "failed") {
    return [];
  }
  const code = readIssueCode(status);
  if (code === null) {
    return [];
  }
  return [{ field: FIELD_OF_ISSUE[code], code }];
}

function SaveFailure({
  translate,
  status,
  onReloadRequested,
}: {
  translate: Translator;
  status: ClubDraftStatus;
  onReloadRequested: () => void;
}): React.JSX.Element | null {
  // Un 400 de un campo ya se enseña junto a ese campo.
  if (status.kind !== "failed" || readIssueCode(status) !== null) {
    return null;
  }
  return (
    <div className="club-settings-failure">
      <p className="auth-error" role="alert">
        {describeClubSettingsFailure(translate, status)}
      </p>
      {isSettingsConflict(status) ? (
        <button
          type="button"
          className="auth-secondary"
          onClick={onReloadRequested}
        >
          {translate("clubSettings.reloadLatest")}
        </button>
      ) : null}
    </div>
  );
}

/** Las iniciales que se ven sin logo: las escritas o, si no hay, las que
 * la aplicación saca del nombre. */
function shownInitialsOf(draft: Draft): string {
  return draft.initials.trim() === ""
    ? deriveInitials(draft.name)
    : draft.initials;
}

type AccentControl = {
  readonly typedColor: string;
  readonly issueText: string | null;
  readonly isDisabled: boolean;
  readonly onChange: (typedColor: string) => void;
};

/** MARCA: el acento viaja con el borrador (#346); el logo, cuando va aquí, se
 * guarda en el acto con sus propios botones (#295). */
function BrandSection({
  translate,
  savedColor,
  accent,
  logo,
}: {
  translate: Translator;
  savedColor: string;
  accent: AccentControl;
  logo: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="auth-fields" aria-labelledby="club-marca">
      <h2 id="club-marca" className="club-general-heading">
        {translate("clubSettings.brand.title")}
      </h2>
      <ClubAccentField
        translate={translate}
        savedColor={savedColor}
        {...accent}
      />
      {logo}
    </section>
  );
}

/** El borrador de la identidad. Guardar manda lo que el Admin tenía delante
 * (`expected`): si otro Admin guardó entretanto, el servidor dice 409. */
function useIdentityDraft(
  initialSettings: ClubSettings,
  onHasDraftChange: (hasDraft: boolean) => void,
): {
  readonly settings: ClubSettings;
  readonly setLogoUrl: (logoUrl: string | null) => void;
  readonly identity: ClubDraft<Draft>;
} {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);

  async function send(draft: Draft): Promise<DraftSaveOutcome<Draft>> {
    const result = await saveClubSettings({
      identity: toIdentity(draft),
      expected: identityOf(settings),
    });
    if (result.kind === "failed") {
      return result;
    }
    setSettings(result.settings);
    router.refresh();
    return { kind: "saved", value: toDraft(result.settings) };
  }

  const identity = useClubDraft<Draft>({
    initial: toDraft(initialSettings),
    isSame: isSameDraft,
    send,
    onHasDraftChange,
  });
  function setLogoUrl(logoUrl: string | null): void {
    setSettings((current) => ({ ...current, logoUrl }));
    // Como al guardar: redibuja la cabecera con el logo nuevo.
    router.refresh();
  }
  return { settings, setLogoUrl, identity };
}

export function ClubSettingsForm({
  translate,
  settings: initialSettings,
  onReloadRequested,
  onHasDraftChange,
}: {
  translate: Translator;
  settings: ClubSettings;
  onReloadRequested: () => void;
  onHasDraftChange: (hasDraft: boolean) => void;
}): React.JSX.Element {
  const { settings, setLogoUrl, identity } = useIdentityDraft(
    initialSettings,
    onHasDraftChange,
  );
  const { draft, status } = identity;
  const isPhone = useIsPhone();
  // El borrador se valida mientras se escribe: Guardar cambios se desactiva
  // y el error sale junto a su campo.
  const localIssues = findClubSettingsIssues({
    identity: toIdentity(draft),
    expected: identityOf(settings),
  });
  const issues = localIssues.length > 0 ? localIssues : serverIssuesOf(status);
  const issueTextFor = (field: ClubIdentityField): string | null => {
    const issue = issues.find((candidate) => candidate.field === field);
    return issue === undefined
      ? null
      : describeClubSettingsIssue(translate, issue.code);
  };
  const isSending = status.kind === "sending";
  const canSave = localIssues.length === 0;
  const update = (change: Partial<Draft>): void =>
    identity.change((current) => ({ ...current, ...change }));
  const shownInitials = shownInitialsOf(draft);
  const accentStyle = accentPreviewStyleOf(
    draft.accentColor,
    settings.accentColor,
  );
  const logo = (
    <ClubLogoField
      translate={translate}
      clubName={settings.name}
      initials={shownInitials}
      logoUrl={settings.logoUrl}
      accentStyle={accentStyle}
      onLogoChanged={setLogoUrl}
    />
  );

  return (
    <form
      className="auth-pending club-settings-form"
      onSubmit={(event) => event.preventDefault()}
      noValidate
    >
      <div className="club-general">
        <div className="club-general-editor">
          {isPhone ? logo : null}
          {/* Mientras se guarda no se edita: lo que se escribiera ahora lo
              pisaría lo que devuelva el servidor. */}
          <fieldset className="member-record-fields" disabled={isSending}>
            <ClubIdentityFields
              translate={translate}
              name={draft.name}
              initials={draft.initials}
              automaticInitials={deriveInitials(draft.name)}
              issueTextFor={issueTextFor}
              onChange={update}
            />
          </fieldset>
          <BrandSection
            translate={translate}
            savedColor={settings.accentColor}
            accent={{
              typedColor: draft.accentColor,
              issueText: issueTextFor("accentColor"),
              isDisabled: isSending,
              onChange: (accentColor) => update({ accentColor }),
            }}
            logo={isPhone ? null : logo}
          />
          <fieldset className="member-record-fields" disabled={isSending}>
            <ClubSeasonField
              translate={translate}
              value={draft.seasonStartsOn}
              issueText={issueTextFor("seasonStartsOn")}
              onChange={(seasonStartsOn) => update({ seasonStartsOn })}
            />
          </fieldset>
          <SaveFailure
            translate={translate}
            status={status}
            onReloadRequested={onReloadRequested}
          />
        </div>
        <ClubGeneralPreview
          translate={translate}
          club={{
            name: draft.name,
            initials: shownInitials,
            logoUrl: settings.logoUrl,
          }}
          accentStyle={accentStyle}
        />
      </div>
      {identity.hasDraft ? (
        <UnsavedChangesBar
          translate={translate}
          section="general"
          headingId={IDENTITY_HEADING_ID}
          canSave={canSave}
          isSaving={isSending}
          onDiscard={identity.discard}
          onSave={() => void identity.save()}
        />
      ) : null}
      <SavedNotice
        translate={translate}
        isShowing={identity.isSavedNoticeShowing}
      />
    </form>
  );
}
