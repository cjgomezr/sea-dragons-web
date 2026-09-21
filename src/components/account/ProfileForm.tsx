"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { RequestFailure } from "@/components/auth/request-failure";
import type { CountryOption } from "@/lib/geo/countries";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import {
  type OwnProfile,
  type OwnProfileSubmission,
  type ProfileIssueCode,
  validateFullName,
} from "@/lib/members/own-profile";
import {
  EXPERIENCE_LEVELS,
  GENDERS,
  POSITIONS,
} from "@/lib/members/profile-fields";
import {
  describeProfileFailure,
  describeProfileIssue,
  saveOwnProfile,
} from "./profile-client";

/**
 * La ficha editable del perfil propio (#241, FR-084): nombre, país,
 * posición, nivel y género. Nada de lo que la decisión B3 reserva al Admin
 * aparece aquí, ni siquiera desactivado.
 *
 * Es de cliente por el estado del envío. Da un cambio por hecho sólo cuando el
 * servidor lo confirma, y entonces refresca la página para que la cabecera
 * enseñe el nombre nuevo.
 */

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "sending" }
  | { readonly kind: "saved" }
  | {
      readonly kind: "failed";
      readonly failure: RequestFailure;
      readonly reason: string | null;
    };

/** Lo que hay en los controles. Una cadena vacía en un desplegable es "sin
 * indicar", y se manda como null. */
type Draft = {
  readonly fullName: string;
  readonly country: string;
  readonly position: string;
  readonly experienceLevel: string;
  readonly gender: string;
};

type DraftField = keyof Draft;

const FULL_NAME_ID = "perfil-nombre";
const FULL_NAME_ERROR_ID = "perfil-nombre-error";

function toDraft(profile: OwnProfile): Draft {
  return {
    fullName: profile.fullName,
    country: profile.country ?? "",
    position: profile.position ?? "",
    experienceLevel: profile.experienceLevel ?? "",
    gender: profile.gender ?? "",
  };
}

function orNull(value: string): string | null {
  return value === "" ? null : value;
}

function toSubmission(draft: Draft): OwnProfileSubmission {
  return {
    fullName: draft.fullName,
    country: draft.country,
    position: orNull(draft.position),
    experienceLevel: orNull(draft.experienceLevel),
    gender: orNull(draft.gender),
  };
}

type SelectOption = { readonly value: string; readonly label: string };

function SelectField({
  id,
  label,
  value,
  options,
  emptyLabel,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly SelectOption[];
  /** El texto de la opción vacía, o null si el campo no se puede vaciar. */
  emptyLabel: string | null;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
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
    <div className="auth-field">
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

function SaveOutcome({
  translate,
  status,
}: {
  translate: Translator;
  status: Status;
}): React.JSX.Element | null {
  switch (status.kind) {
    case "saved":
      return (
        <p className="auth-note" role="status">
          {translate("account.profile.saved")}
        </p>
      );
    case "failed":
      return (
        <p className="auth-error" role="alert">
          {describeProfileFailure(translate, status.failure, status.reason)}
        </p>
      );
    default:
      return null;
  }
}

/** Las claves se arman con el valor del catálogo, así que el compilador
 * comprueba que el mensaje de cada uno exista en los dos idiomas. */
function catalogOptions(translate: Translator): {
  readonly positions: readonly SelectOption[];
  readonly experienceLevels: readonly SelectOption[];
  readonly genders: readonly SelectOption[];
} {
  return {
    positions: POSITIONS.map((value) => ({
      value,
      label: translate(`position.${value}`),
    })),
    experienceLevels: EXPERIENCE_LEVELS.map((value) => ({
      value,
      label: translate(`level.${value}`),
    })),
    genders: GENDERS.map((value) => ({
      value,
      label: translate(`gender.${value}`),
    })),
  };
}

export function ProfileForm({
  locale,
  profile,
  countries,
}: {
  locale: Locale;
  profile: OwnProfile;
  countries: readonly CountryOption[];
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile));
  const [nameIssue, setNameIssue] = useState<ProfileIssueCode | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "editing" });
  // El estado desactiva el botón en el siguiente pintado, pero un doble clic
  // llega antes. La referencia cambia en el acto.
  const isSendingRef = useRef(false);

  function update(field: DraftField, value: string): void {
    setDraft((current) => ({ ...current, [field]: value }));
    if (field === "fullName") {
      setNameIssue(null);
    }
    // Un aviso habla del envío anterior. Mientras se envía no se toca, o el
    // botón volvería a activarse.
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
    const issue = validateFullName(draft.fullName);
    if (issue !== null) {
      setNameIssue(issue);
      return;
    }

    isSendingRef.current = true;
    setStatus({ kind: "sending" });
    const result = await saveOwnProfile(toSubmission(draft));
    isSendingRef.current = false;
    if (result.kind === "failed") {
      setStatus(result);
      return;
    }
    setDraft(toDraft(result.profile));
    setStatus({ kind: "saved" });
    router.refresh();
  }

  const isSending = status.kind === "sending";
  const options = catalogOptions(translate);
  return (
    <section className="auth-pending" aria-labelledby="mis-datos">
      <h2 id="mis-datos">{translate("account.profile.title")}</h2>
      <form className="auth-fields" onSubmit={handleSubmit} noValidate>
        <FullNameField
          translate={translate}
          value={draft.fullName}
          issue={nameIssue}
          onChange={(value) => update("fullName", value)}
        />
        <SelectField
          id="perfil-pais"
          label={translate("account.profile.country")}
          value={draft.country}
          options={countries.map((country) => ({
            value: country.code,
            label: country.name,
          }))}
          // El país no se vacía: FR-001 lo pide para tener la cuenta activa.
          // Sólo una fila vieja sin país necesita la opción de elegir.
          emptyLabel={
            profile.country === null
              ? translate("auth.field.countryPlaceholder")
              : null
          }
          onChange={(value) => update("country", value)}
        />
        <SelectField
          id="perfil-posicion"
          label={translate("account.profile.position")}
          value={draft.position}
          options={options.positions}
          emptyLabel={translate("account.profile.notSet")}
          onChange={(value) => update("position", value)}
        />
        <SelectField
          id="perfil-nivel"
          label={translate("account.profile.experienceLevel")}
          value={draft.experienceLevel}
          options={options.experienceLevels}
          emptyLabel={translate("account.profile.notSet")}
          onChange={(value) => update("experienceLevel", value)}
        />
        <SelectField
          id="perfil-genero"
          label={translate("account.profile.gender")}
          value={draft.gender}
          options={options.genders}
          emptyLabel={translate("account.profile.notSet")}
          onChange={(value) => update("gender", value)}
        />
        <SaveOutcome translate={translate} status={status} />
        <button type="submit" className="auth-submit" disabled={isSending}>
          {translate(
            isSending ? "account.profile.saving" : "account.profile.save",
          )}
        </button>
      </form>
    </section>
  );
}
