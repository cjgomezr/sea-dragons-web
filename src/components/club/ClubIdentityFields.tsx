"use client";

import {
  CLUB_INITIALS_MAX_LENGTH,
  CLUB_NAME_MAX_LENGTH,
  CLUB_REGISTRATION_NAME_MAX_LENGTH,
} from "@/lib/club/club-settings";
import { countCharacters } from "@/lib/club/sign-in-texts";
import type { Translator } from "@/lib/i18n/translator";

/**
 * IDENTIDAD en la pestaña General (#720): el nombre con su contador, las
 * iniciales opcionales, que de marcador enseñan las que la aplicación saca
 * del nombre si se dejan vacías, y el nombre del registro de los miembros
 * (#967), también con su contador.
 */

export const IDENTITY_HEADING_ID = "club-identidad";
const NAME_ID = "club-nombre";
const NAME_COUNTER_ID = "club-nombre-contador";
const NAME_ISSUE_ID = "club-nombre-aviso";
const INITIALS_ID = "club-iniciales";
const INITIALS_HINT_ID = "club-iniciales-ayuda";
const INITIALS_ISSUE_ID = "club-iniciales-aviso";
const REGISTRATION_ID = "club-registro";
const REGISTRATION_COUNTER_ID = "club-registro-contador";
const REGISTRATION_HINT_ID = "club-registro-ayuda";
const REGISTRATION_ISSUE_ID = "club-registro-aviso";

type FieldProps = {
  readonly translate: Translator;
  readonly value: string;
  readonly issueText: string | null;
  readonly onChange: (value: string) => void;
};

/** Primero el aviso y luego la ayuda, como en los demás campos. */
function describedByOf(
  issueText: string | null,
  issueId: string,
  hintId: string,
): string {
  return issueText === null ? hintId : `${issueId} ${hintId}`;
}

function FieldIssue({
  id,
  text,
}: {
  id: string;
  text: string | null;
}): React.JSX.Element | null {
  return text === null ? null : (
    <p className="auth-field-error" id={id}>
      {text}
    </p>
  );
}

function FieldCounter({
  translate,
  id,
  value,
  max,
}: {
  translate: Translator;
  id: string;
  value: string;
  max: number;
}): React.JSX.Element {
  const count = countCharacters(value);
  return (
    <span
      className={
        count > max
          ? "club-field-counter club-field-counter-over"
          : "club-field-counter"
      }
      id={id}
    >
      {translate("clubSettings.name.counter", { count, max })}
    </span>
  );
}

function NameField({
  translate,
  value,
  issueText,
  onChange,
}: FieldProps): React.JSX.Element {
  return (
    <div className="auth-field">
      <div className="club-field-heading">
        <label htmlFor={NAME_ID}>{translate("clubSettings.name.label")}</label>
        <FieldCounter
          translate={translate}
          id={NAME_COUNTER_ID}
          value={value}
          max={CLUB_NAME_MAX_LENGTH}
        />
      </div>
      <input
        id={NAME_ID}
        type="text"
        value={value}
        autoComplete="off"
        aria-invalid={issueText !== null}
        aria-describedby={describedByOf(
          issueText,
          NAME_ISSUE_ID,
          NAME_COUNTER_ID,
        )}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldIssue id={NAME_ISSUE_ID} text={issueText} />
    </div>
  );
}

function InitialsField({
  translate,
  value,
  issueText,
  onChange,
  automaticInitials,
}: FieldProps & { readonly automaticInitials: string }): React.JSX.Element {
  return (
    <div className="auth-field club-initials-field">
      <label htmlFor={INITIALS_ID}>
        {translate("clubSettings.initials.label")}{" "}
        <span className="club-field-optional">
          · {translate("clubSettings.initials.optional")}
        </span>
      </label>
      <input
        id={INITIALS_ID}
        type="text"
        value={value}
        placeholder={automaticInitials}
        autoComplete="off"
        aria-invalid={issueText !== null}
        aria-describedby={describedByOf(
          issueText,
          INITIALS_ISSUE_ID,
          INITIALS_HINT_ID,
        )}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldIssue id={INITIALS_ISSUE_ID} text={issueText} />
      <p className="auth-hint" id={INITIALS_HINT_ID}>
        {translate("clubSettings.initials.hint", {
          max: CLUB_INITIALS_MAX_LENGTH,
        })}
      </p>
    </div>
  );
}

/** El nombre del registro (#967): como el del club, con su contador, y
 * además una ayuda que dice qué es. Vacío es la palabra de la app. */
function RegistrationNameField({
  translate,
  value,
  issueText,
  onChange,
}: FieldProps): React.JSX.Element {
  const hintIds = `${REGISTRATION_COUNTER_ID} ${REGISTRATION_HINT_ID}`;
  return (
    <div className="auth-field">
      <div className="club-field-heading">
        <label htmlFor={REGISTRATION_ID}>
          {translate("clubSettings.registrationName.label")}
        </label>
        <FieldCounter
          translate={translate}
          id={REGISTRATION_COUNTER_ID}
          value={value}
          max={CLUB_REGISTRATION_NAME_MAX_LENGTH}
        />
      </div>
      <input
        id={REGISTRATION_ID}
        type="text"
        value={value}
        autoComplete="off"
        aria-invalid={issueText !== null}
        aria-describedby={describedByOf(
          issueText,
          REGISTRATION_ISSUE_ID,
          hintIds,
        )}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldIssue id={REGISTRATION_ISSUE_ID} text={issueText} />
      <p className="auth-hint" id={REGISTRATION_HINT_ID}>
        {translate("clubSettings.registrationName.hint")}
      </p>
    </div>
  );
}

type IdentityText = "name" | "initials" | "registrationName";

export function ClubIdentityFields({
  translate,
  name,
  initials,
  registrationName,
  automaticInitials,
  issueTextFor,
  onChange,
}: {
  translate: Translator;
  name: string;
  initials: string;
  registrationName: string;
  automaticInitials: string;
  issueTextFor: (field: IdentityText) => string | null;
  onChange: (change: Partial<Record<IdentityText, string>>) => void;
}): React.JSX.Element {
  return (
    <section className="auth-fields" aria-labelledby={IDENTITY_HEADING_ID}>
      <h2
        id={IDENTITY_HEADING_ID}
        className="club-general-heading"
        tabIndex={-1}
      >
        {translate("clubSettings.identity.title")}
      </h2>
      <NameField
        translate={translate}
        value={name}
        issueText={issueTextFor("name")}
        onChange={(value) => onChange({ name: value })}
      />
      <InitialsField
        translate={translate}
        value={initials}
        automaticInitials={automaticInitials}
        issueText={issueTextFor("initials")}
        onChange={(value) => onChange({ initials: value })}
      />
      <RegistrationNameField
        translate={translate}
        value={registrationName}
        issueText={issueTextFor("registrationName")}
        onChange={(value) => onChange({ registrationName: value })}
      />
    </section>
  );
}
