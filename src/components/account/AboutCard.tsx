"use client";

import { Lock } from "@phosphor-icons/react/dist/ssr/Lock";
import { useState } from "react";
import { SegmentedChoice } from "@/components/SegmentedChoice";
import {
  type ClubPosition,
  type ClubPositions,
  offeredPositions,
  positionName,
} from "@/lib/club/club-positions";
import { type CountryOption, countryName } from "@/lib/geo/countries";
import type { Translator } from "@/lib/i18n/translator";
import {
  type OwnProfile,
  type OwnProfileSubmission,
  type ProfileIssueCode,
  validateFullName,
} from "@/lib/members/own-profile";
import {
  EXPERIENCE_LEVELS,
  type ExperienceLevel,
  GENDERS,
} from "@/lib/members/profile-fields";
import { DetailList, type DetailRow } from "./DetailList";
import { CardForm, EditableCard } from "./EditableCard";
import {
  type ProfileSaveResult,
  describeProfileFailure,
  describeProfileIssue,
  saveOwnProfile,
} from "./profile-client";
import { useCardSubmission } from "./use-card-submission";

/**
 * Sobre mí en el perfil propio (#772, RF-3 del PRD de E30): el nombre, el
 * país, la posición, la experiencia y el género, que sólo ve el socio (D4).
 * Se lee primero y se edita aparte. Guardar manda lo suyo con el contacto
 * tal como está guardado y sin el AUF, que es no tocarlo: la API pide los
 * campos del perfil siempre.
 *
 * Las posiciones son las del club (#299). Una retirada sólo sale para quien
 * la tiene, marcada; si el club no ofrece ninguna, ni se lee ni se edita.
 */

export const ABOUT_HEADING_ID = "perfil-sobre-mi";
export const FULL_NAME_ID = "perfil-nombre";
/** La franja de lo que falta (#771) pone aquí el foco cuando falta el país. */
export const COUNTRY_ID = "perfil-pais";
const FULL_NAME_ERROR_ID = "perfil-nombre-error";
const GENDER_HINT_ID = "perfil-genero-pista";

/** Lo que hay en los controles. Una cadena vacía en un desplegable es "sin
 * indicar", y se manda como null. */
type AboutDraft = {
  readonly fullName: string;
  readonly country: string;
  readonly positionId: string;
  readonly experienceLevel: ExperienceLevel | null;
  readonly gender: string;
};

type SelectOption = { readonly value: string; readonly label: string };

function aboutDraftOf(profile: OwnProfile): AboutDraft {
  return {
    fullName: profile.fullName,
    country: profile.country ?? "",
    positionId: profile.positionId ?? "",
    experienceLevel: profile.experienceLevel,
    gender: profile.gender ?? "",
  };
}

function isSameDraft(left: AboutDraft, right: AboutDraft): boolean {
  return (
    left.fullName === right.fullName &&
    left.country === right.country &&
    left.positionId === right.positionId &&
    left.experienceLevel === right.experienceLevel &&
    left.gender === right.gender
  );
}

function orNull(value: string): string | null {
  return value === "" ? null : value;
}

function toAboutSubmission(
  draft: AboutDraft,
  profile: OwnProfile,
): OwnProfileSubmission {
  return {
    fullName: draft.fullName,
    country: draft.country,
    positionId: orNull(draft.positionId),
    experienceLevel: draft.experienceLevel,
    gender: orNull(draft.gender),
    phone: profile.phone,
    emergencyContact: profile.emergencyContact,
    auf: null,
  };
}

/** El nombre del club en el idioma de la pantalla, y la retirada marcada:
 * quien la tiene sabe así por qué no la encuentra nadie más. */
function positionLabel(translate: Translator, position: ClubPosition): string {
  const name = positionName(position.names, translate.locale);
  return position.isArchived
    ? translate("account.profile.positionRetired", { name })
    : name;
}

function aboutRows(
  translate: Translator,
  profile: OwnProfile,
  positions: readonly ClubPosition[],
): readonly DetailRow[] {
  const position = positions.find(({ id }) => id === profile.positionId);
  const rows: readonly (DetailRow | null)[] = [
    {
      label: translate("profileCard.about.fullName"),
      value: profile.fullName,
      isOnlyYou: false,
    },
    {
      label: translate("profileCard.about.country"),
      value:
        profile.country === null
          ? null
          : countryName(translate.locale, profile.country),
      isOnlyYou: false,
    },
    positions.length === 0
      ? null
      : {
          label: translate("profileCard.about.position"),
          value:
            position === undefined ? null : positionLabel(translate, position),
          isOnlyYou: false,
        },
    {
      label: translate("profileCard.about.experience"),
      value:
        profile.experienceLevel === null
          ? null
          : translate(`level.${profile.experienceLevel}`),
      isOnlyYou: false,
    },
    {
      label: translate("profileCard.about.gender"),
      value:
        profile.gender === null ? null : translate(`gender.${profile.gender}`),
      isOnlyYou: true,
    },
  ];
  return rows.filter((row) => row !== null);
}

function SelectField({
  id,
  label,
  value,
  options,
  emptyLabel,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly SelectOption[];
  /** El texto de la opción vacía, o null si el campo no se puede vaciar. */
  emptyLabel: string | null;
  /** Lo que acompaña a la etiqueta y describe el campo, o null. */
  hint: { readonly id: string; readonly content: React.ReactNode } | null;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <div className="auth-field">
      <div className="profile-card-label">
        <label htmlFor={id}>{label}</label>
        {hint === null ? null : (
          <span className="profile-card-only-you" id={hint.id}>
            {hint.content}
          </span>
        )}
      </div>
      <select
        id={id}
        value={value}
        aria-describedby={hint === null ? undefined : hint.id}
        onChange={(event) => onChange(event.target.value)}
      >
        {emptyLabel === null ? null : <option value="">{emptyLabel}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function FullNameField({
  translate,
  value,
  issue,
  onChange,
}: {
  translate: Translator;
  value: string;
  issue: ProfileIssueCode | null;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <div className="auth-field profile-card-wide">
      <label htmlFor={FULL_NAME_ID}>
        {translate("account.profile.fullName")}
      </label>
      <input
        id={FULL_NAME_ID}
        name="fullName"
        type="text"
        autoComplete="name"
        value={value}
        aria-invalid={issue !== null}
        aria-describedby={issue === null ? undefined : FULL_NAME_ERROR_ID}
        onChange={(event) => onChange(event.target.value)}
      />
      {issue === null ? null : (
        <p className="auth-field-error" id={FULL_NAME_ERROR_ID}>
          {describeProfileIssue(translate, issue)}
        </p>
      )}
    </div>
  );
}

type AboutEditorProps = {
  readonly translate: Translator;
  readonly profile: OwnProfile;
  readonly positions: readonly ClubPosition[];
  readonly countries: readonly CountryOption[];
  readonly onSaved: (profile: OwnProfile) => void;
  readonly onCancel: () => void;
  readonly onChanges: (hasChanges: boolean) => void;
};

function AboutEditor({
  translate,
  profile,
  positions,
  countries,
  onSaved,
  onCancel,
  onChanges,
}: AboutEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState(() => aboutDraftOf(profile));
  const [nameIssue, setNameIssue] = useState<ProfileIssueCode | null>(null);
  const submission = useCardSubmission<ProfileSaveResult>();

  function update(change: Partial<AboutDraft>): void {
    const next = { ...draft, ...change };
    setDraft(next);
    if ("fullName" in change) {
      setNameIssue(null);
    }
    submission.clearFailure();
    onChanges(!isSameDraft(next, aboutDraftOf(profile)));
  }

  function handleSubmit(): void {
    const issue = validateFullName(draft.fullName);
    if (issue !== null) {
      setNameIssue(issue);
      return;
    }
    void submission.submit(
      () => saveOwnProfile(toAboutSubmission(draft, profile)),
      (result) => onSaved(result.profile),
    );
  }

  const { status } = submission;
  return (
    <CardForm
      translate={translate}
      isSending={submission.isSending}
      failureText={
        status.kind === "failed"
          ? describeProfileFailure(translate, status.failure, status.reason)
          : null
      }
      onSubmit={handleSubmit}
      onCancel={onCancel}
    >
      <div className="profile-card-grid">
        <FullNameField
          translate={translate}
          value={draft.fullName}
          issue={nameIssue}
          onChange={(fullName) => update({ fullName })}
        />
        <SelectField
          id={COUNTRY_ID}
          label={translate("account.profile.country")}
          value={draft.country}
          options={countries.map(({ code, name }) => ({
            value: code,
            label: name,
          }))}
          // El país no se vacía: FR-001 lo pide para tener la cuenta activa.
          // Sólo una fila vieja sin país necesita la opción de elegir.
          emptyLabel={
            profile.country === null
              ? translate("auth.field.countryPlaceholder")
              : null
          }
          hint={null}
          onChange={(country) => update({ country })}
        />
        {positions.length === 0 ? null : (
          <SelectField
            id="perfil-posicion"
            label={translate("account.profile.position")}
            value={draft.positionId}
            options={positions.map((position) => ({
              value: position.id,
              label: positionLabel(translate, position),
            }))}
            emptyLabel={translate("account.profile.notSet")}
            hint={null}
            onChange={(positionId) => update({ positionId })}
          />
        )}
        <SegmentedChoice
          label={translate("profileCard.about.experience")}
          options={EXPERIENCE_LEVELS.map((value) => ({
            value,
            label: translate(`level.${value}`),
            icon: null,
          }))}
          selected={draft.experienceLevel}
          onChoose={(experienceLevel) => update({ experienceLevel })}
        />
        <SelectField
          id="perfil-genero"
          label={translate("account.profile.gender")}
          value={draft.gender}
          options={GENDERS.map((value) => ({
            value,
            label: translate(`gender.${value}`),
          }))}
          emptyLabel={translate("account.profile.notSet")}
          hint={{
            id: GENDER_HINT_ID,
            content: (
              <>
                <Lock aria-hidden="true" weight="regular" />
                {translate("profileCard.onlyYou")}
              </>
            ),
          }}
          onChange={(gender) => update({ gender })}
        />
      </div>
    </CardForm>
  );
}

export function AboutCard({
  translate,
  profile,
  positionOptions,
  countries,
  isEditing,
  focusFieldId,
  savedText,
  onEdit,
  onSaved,
  onCancel,
  onChanges,
}: Omit<AboutEditorProps, "positions"> & {
  readonly positionOptions: ClubPositions;
  readonly isEditing: boolean;
  readonly focusFieldId: string;
  readonly savedText: string | null;
  readonly onEdit: () => void;
}): React.JSX.Element {
  // La posición guardada decide si la retirada se sigue ofreciendo: quien la
  // cambió y guardó ya no puede volver a ella.
  const positions = offeredPositions(positionOptions, profile.positionId);
  return (
    <EditableCard
      translate={translate}
      headingId={ABOUT_HEADING_ID}
      title={translate("profileCard.about.title")}
      isEditing={isEditing}
      focusFieldId={focusFieldId}
      savedText={savedText}
      onEdit={onEdit}
    >
      {isEditing ? (
        <AboutEditor
          translate={translate}
          profile={profile}
          positions={positions}
          countries={countries}
          onSaved={onSaved}
          onCancel={onCancel}
          onChanges={onChanges}
        />
      ) : (
        <DetailList
          translate={translate}
          rows={aboutRows(translate, profile, positions)}
        />
      )}
    </EditableCard>
  );
}
