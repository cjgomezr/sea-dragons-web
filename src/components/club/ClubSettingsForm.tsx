"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TextField } from "@/components/directory/record-fields";
import { normalizeAccentInput } from "@/lib/club/accent-color";
import { deriveInitials } from "@/lib/club/club-brand";
import {
  CLUB_INITIALS_MAX_LENGTH,
  CLUB_NAME_MAX_LENGTH,
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
import { ACCENT_FIELD_ID, ClubAccentField } from "./ClubAccentField";
import { ClubLogoField } from "./ClubLogoField";
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
 * barra de cambios sin guardar (#719), que sólo sale con un borrador.
 *
 * Cada guardado lleva lo que el Admin tenía delante. Si otro Admin guardó
 * entretanto, el servidor responde 409 y la pantalla ofrece cargar lo último
 * en vez de pisarlo. Tras guardar se refresca la página en el servidor, que
 * es lo que redibuja la cabecera con el nombre nuevo.
 */

/** Lo que hay en los controles. Unas iniciales vacías se mandan como null, y
 * el acento se manda como lo guarda la base, escriba lo que escriba el Admin. */
type Draft = {
  readonly name: string;
  readonly initials: string;
  readonly accentColor: string;
};

const NAME_ID = "club-nombre";
const NAME_HINT_ID = "club-nombre-ayuda";
const INITIALS_ID = "club-iniciales";
const INITIALS_HINT_ID = "club-iniciales-ayuda";

const FIELD_OF_ISSUE: Readonly<
  Record<ClubSettingsIssueCode, ClubIdentityField>
> = {
  name_required: "name",
  name_too_long: "name",
  initials_too_long: "initials",
  accent_color_invalid: "accentColor",
  accent_color_no_readable_text: "accentColor",
};

function toDraft(settings: ClubSettings): Draft {
  return {
    name: settings.name,
    initials: settings.initials ?? "",
    accentColor: settings.accentColor.toUpperCase(),
  };
}

function toIdentity(draft: Draft): ClubIdentity {
  return {
    name: draft.name,
    initials: draft.initials.trim() === "" ? null : draft.initials,
    accentColor: normalizeAccentInput(draft.accentColor),
  };
}

function identityOf(settings: ClubSettings): ClubIdentity {
  return {
    name: settings.name,
    initials: settings.initials,
    accentColor: settings.accentColor,
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

/** El acento se elige aquí (#346) y viaja con el botón del formulario; el
 * logo se guarda en el acto con sus propios botones (#295). */
function BrandSummary({
  translate,
  settings,
  accent,
  onLogoChanged,
}: {
  translate: Translator;
  settings: ClubSettings;
  accent: {
    readonly typedColor: string;
    readonly issueText: string | null;
    readonly isDisabled: boolean;
    readonly onChange: (typedColor: string) => void;
  };
  onLogoChanged: (logoUrl: string | null) => void;
}): React.JSX.Element {
  const initials = settings.initials ?? deriveInitials(settings.name);
  return (
    <section className="auth-fields" aria-labelledby="club-marca">
      <h2 id="club-marca">{translate("clubSettings.brand.title")}</h2>
      <dl className="club-settings-brand">
        <div className="club-settings-brand-row">
          <dt>
            <label htmlFor={ACCENT_FIELD_ID}>
              {translate("clubSettings.accent.label")}
            </label>
          </dt>
          <dd>
            <ClubAccentField
              translate={translate}
              savedColor={settings.accentColor}
              {...accent}
            />
          </dd>
        </div>
        <div className="club-settings-brand-row">
          <dt>{translate("clubSettings.logo.label")}</dt>
          <dd>
            <ClubLogoField
              translate={translate}
              clubName={settings.name}
              initials={initials}
              logoUrl={settings.logoUrl}
              onLogoChanged={onLogoChanged}
            />
          </dd>
        </div>
      </dl>
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

  return (
    <form
      className="auth-pending club-settings-form"
      onSubmit={(event) => event.preventDefault()}
      noValidate
    >
      {/* Mientras se guarda no se edita: lo que se escribiera ahora lo
          pisaría lo que devuelva el servidor. */}
      <fieldset className="member-record-fields" disabled={isSending}>
        <section className="auth-fields" aria-labelledby="club-identidad">
          <h2 id="club-identidad" tabIndex={-1}>
            {translate("clubSettings.identity.title")}
          </h2>
          <TextField
            id={NAME_ID}
            label={translate("clubSettings.name.label")}
            type="text"
            value={draft.name}
            issueText={issueTextFor("name")}
            hintIds={[NAME_HINT_ID]}
            onChange={(name) => update({ name })}
          />
          <p className="auth-hint" id={NAME_HINT_ID}>
            {translate("clubSettings.name.hint", { max: CLUB_NAME_MAX_LENGTH })}
          </p>
          <TextField
            id={INITIALS_ID}
            label={translate("clubSettings.initials.label")}
            type="text"
            value={draft.initials}
            issueText={issueTextFor("initials")}
            hintIds={[INITIALS_HINT_ID]}
            onChange={(initials) => update({ initials })}
          />
          <p className="auth-hint" id={INITIALS_HINT_ID}>
            {translate("clubSettings.initials.hint", {
              max: CLUB_INITIALS_MAX_LENGTH,
            })}
          </p>
        </section>
      </fieldset>
      <BrandSummary
        translate={translate}
        settings={settings}
        accent={{
          typedColor: draft.accentColor,
          issueText: issueTextFor("accentColor"),
          isDisabled: isSending,
          onChange: (accentColor) => update({ accentColor }),
        }}
        onLogoChanged={setLogoUrl}
      />
      <SaveFailure
        translate={translate}
        status={status}
        onReloadRequested={onReloadRequested}
      />
      {identity.hasDraft ? (
        <UnsavedChangesBar
          translate={translate}
          section="general"
          headingId="club-identidad"
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
