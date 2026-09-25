"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
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
} from "@/lib/club/club-settings";
import type { Translator } from "@/lib/i18n/translator";
import {
  type ClubSettingsFailure,
  describeClubSettingsFailure,
  describeClubSettingsIssue,
  isSettingsConflict,
  readIssueCode,
  saveClubSettings,
} from "./club-settings-client";
import { ACCENT_FIELD_ID, ClubAccentField } from "./ClubAccentField";
import { ClubLogoField } from "./ClubLogoField";

/**
 * El formulario de la configuración del club (#296). Sigue a la ficha del
 * miembro (`MemberRecordForm`): da un cambio por hecho sólo cuando el servidor
 * lo confirma, y entonces enseña lo que el servidor guardó.
 *
 * Cada guardado lleva lo que el Admin tenía delante. Si otro Admin guardó
 * entretanto, el servidor responde 409 y la pantalla ofrece cargar lo último
 * en vez de pisarlo. Tras guardar se refresca la página en el servidor, que
 * es lo que redibuja la cabecera con el nombre nuevo.
 */

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "sending" }
  | { readonly kind: "saved" }
  | ClubSettingsFailure;

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

/** Los avisos de campo del último envío que el servidor rechazó por uno. */
function serverIssuesOf(status: Status): readonly ClubSettingsIssue[] {
  if (status.kind !== "failed") {
    return [];
  }
  const code = readIssueCode(status);
  if (code === null) {
    return [];
  }
  return [{ field: FIELD_OF_ISSUE[code], code }];
}

function SaveOutcome({
  translate,
  status,
  onReloadRequested,
}: {
  translate: Translator;
  status: Status;
  onReloadRequested: () => void;
}): React.JSX.Element | null {
  if (status.kind === "saved") {
    return (
      <p className="auth-note" role="status">
        {translate("clubSettings.saved")}
      </p>
    );
  }
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

export function ClubSettingsForm({
  translate,
  settings: initialSettings,
  onReloadRequested,
}: {
  translate: Translator;
  settings: ClubSettings;
  onReloadRequested: () => void;
}): React.JSX.Element {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [draft, setDraft] = useState<Draft>(() => toDraft(initialSettings));
  const [status, setStatus] = useState<Status>({ kind: "editing" });
  const [localIssues, setLocalIssues] = useState<readonly ClubSettingsIssue[]>(
    [],
  );
  // El estado desactiva el botón en el siguiente pintado, pero un doble clic
  // llega antes. La referencia cambia en el acto.
  const isSendingRef = useRef(false);

  function update(change: Partial<Draft>): void {
    setDraft((current) => ({ ...current, ...change }));
    setLocalIssues([]);
    setStatus((current) =>
      current.kind === "sending" ? current : { kind: "editing" },
    );
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (isSendingRef.current) {
      return;
    }
    const identity = toIdentity(draft);
    const expected: ClubIdentity = {
      name: settings.name,
      initials: settings.initials,
      accentColor: settings.accentColor,
    };
    const issues = findClubSettingsIssues({ identity, expected });
    if (issues.length > 0) {
      setLocalIssues(issues);
      return;
    }
    isSendingRef.current = true;
    setStatus({ kind: "sending" });
    const result = await saveClubSettings({
      identity,
      expected,
    });
    isSendingRef.current = false;
    if (result.kind === "failed") {
      setStatus(result);
      return;
    }
    setSettings(result.settings);
    setDraft(toDraft(result.settings));
    setStatus({ kind: "saved" });
    router.refresh();
  }

  const issues = localIssues.length > 0 ? localIssues : serverIssuesOf(status);
  const issueTextFor = (field: ClubIdentityField): string | null => {
    const issue = issues.find((candidate) => candidate.field === field);
    return issue === undefined
      ? null
      : describeClubSettingsIssue(translate, issue.code);
  };
  const isSending = status.kind === "sending";

  return (
    <form
      className="auth-pending club-settings-form"
      onSubmit={handleSubmit}
      noValidate
    >
      {/* Mientras se guarda no se edita: lo que se escribiera ahora lo
          pisaría lo que devuelva el servidor. */}
      <fieldset className="member-record-fields" disabled={isSending}>
        <section className="auth-fields" aria-labelledby="club-identidad">
          <h2 id="club-identidad">
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
        onLogoChanged={(logoUrl) => {
          setSettings((current) => ({ ...current, logoUrl }));
          // Como al guardar: redibuja la cabecera con el logo nuevo.
          router.refresh();
        }}
      />
      <SaveOutcome
        translate={translate}
        status={status}
        onReloadRequested={onReloadRequested}
      />
      <button type="submit" className="auth-submit" disabled={isSending}>
        {translate(isSending ? "clubSettings.saving" : "clubSettings.save")}
      </button>
    </form>
  );
}
