"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { RequestFailure } from "@/components/auth/request-failure";
import {
  type ClubPosition,
  type ClubPositions,
  offeredPositions,
  positionName,
} from "@/lib/club/club-positions";
import type { CountryOption } from "@/lib/geo/countries";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import {
  type AufProposal,
  type EmergencyContactProposal,
  type OwnAuf,
  type OwnProfile,
  type OwnProfileSubmission,
  type ProfileIssueCode,
  validateAufNumber,
  validateFullName,
} from "@/lib/members/own-profile";
import {
  type ContactField,
  type ContactIssue,
  contactIssuesOf,
} from "@/lib/members/profile-contact";
import { EXPERIENCE_LEVELS, GENDERS } from "@/lib/members/profile-fields";
import { type AufDraft, OwnAufSection } from "./OwnAufSection";
import {
  type ContactDraft,
  type GuardianProposal,
  OwnContactSection,
  contactDraftOf,
  toContactSubmission,
} from "./OwnContactSection";
import {
  describeProfileFailure,
  describeProfileIssue,
  saveOwnProfile,
} from "./profile-client";

/**
 * La ficha editable del perfil propio (#241, FR-084): nombre, país,
 * posición, nivel y género, el AUF que el miembro propone (#274) y su
 * teléfono y contacto de emergencia (#496). Nada más
 * de lo que la decisión B3 reserva al Admin aparece aquí, ni siquiera
 * desactivado.
 *
 * Las posiciones son las del club (#299). Una retirada sólo sale para quien
 * la tiene, marcada; si el club no ofrece ninguna, el campo no se pinta.
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
type Draft = AufDraft &
  ContactDraft & {
    readonly fullName: string;
    readonly country: string;
    readonly positionId: string;
    readonly experienceLevel: string;
    readonly gender: string;
  };

const FULL_NAME_ID = "perfil-nombre";
const FULL_NAME_ERROR_ID = "perfil-nombre-error";

function toDraft(
  profile: OwnProfile,
  guardian: GuardianProposal | null,
): Draft {
  return {
    ...contactDraftOf(profile, guardian),
    fullName: profile.fullName,
    country: profile.country ?? "",
    positionId: profile.positionId ?? "",
    experienceLevel: profile.experienceLevel ?? "",
    gender: profile.gender ?? "",
    aufNumber: profile.auf.status === "none" ? "" : profile.auf.number,
    aufExpiry: profile.auf.status === "none" ? "" : (profile.auf.expiry ?? ""),
  };
}

function orNull(value: string): string | null {
  return value === "" ? null : value;
}

/** Un AUF verificado no se manda: sólo lo cambia un Admin. Tampoco unos
 * campos que siguen vacíos sin haber AUF, que no proponen nada. */
function toAufProposal(draft: Draft, auf: OwnAuf): AufProposal | null {
  const isUntouchedEmpty =
    auf.status === "none" && draft.aufNumber === "" && draft.aufExpiry === "";
  if (auf.status === "verified" || isUntouchedEmpty) {
    return null;
  }
  return { number: draft.aufNumber, expiry: orNull(draft.aufExpiry) };
}

function toSubmission(
  draft: Draft,
  auf: OwnAuf,
  guardian: GuardianProposal | null,
): OwnProfileSubmission {
  return {
    fullName: draft.fullName,
    country: draft.country,
    positionId: orNull(draft.positionId),
    experienceLevel: orNull(draft.experienceLevel),
    gender: orNull(draft.gender),
    ...toContactSubmission(draft, guardian),
    auf: toAufProposal(draft, auf),
  };
}

/** Lo que se puede avisar antes de enviar, campo a campo. */
type LocalIssues = {
  readonly fullName: ProfileIssueCode | null;
  readonly aufNumber: ProfileIssueCode | null;
  readonly contact: readonly ContactIssue[];
};

const NO_LOCAL_ISSUES: LocalIssues = {
  fullName: null,
  aufNumber: null,
  contact: [],
};

function localIssuesOf(submission: OwnProfileSubmission): LocalIssues {
  return {
    fullName: validateFullName(submission.fullName),
    aufNumber:
      submission.auf === null ? null : validateAufNumber(submission.auf.number),
    contact: contactIssuesOf(submission),
  };
}

function hasLocalIssues(issues: LocalIssues): boolean {
  return (
    issues.fullName !== null ||
    issues.aufNumber !== null ||
    issues.contact.length > 0
  );
}

/** Editar un campo borra su aviso y deja los demás. */
function withoutIssuesOf(
  issues: LocalIssues,
  change: Partial<Draft>,
): LocalIssues {
  return {
    fullName: "fullName" in change ? null : issues.fullName,
    aufNumber: "aufNumber" in change ? null : issues.aufNumber,
    contact: issues.contact.filter((issue) => !(issue.field in change)),
  };
}

function guardianProposalOf(
  translate: Translator,
  proposal: EmergencyContactProposal | null,
): GuardianProposal | null {
  return proposal === null
    ? null
    : {
        name: proposal.guardianName,
        relationship: translate("account.profile.contact.guardianRelationship"),
      };
}

function contactIssueText(
  translate: Translator,
  issues: LocalIssues,
  field: ContactField,
): string | null {
  const issue = issues.contact.find((candidate) => candidate.field === field);
  return issue === undefined
    ? null
    : describeProfileIssue(translate, issue.code);
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

/** El nombre del club en el idioma de la pantalla, y la retirada marcada:
 * quien la tiene sabe así por qué no la encuentra nadie más. */
function positionOption(
  translate: Translator,
  position: ClubPosition,
): SelectOption {
  const name = positionName(position.names, translate.locale);
  return {
    value: position.id,
    label: position.isArchived
      ? translate("account.profile.positionRetired", { name })
      : name,
  };
}

/** Las claves se arman con el valor del catálogo, así que el compilador
 * comprueba que el mensaje de cada uno exista en los dos idiomas. */
function catalogOptions(translate: Translator): {
  readonly experienceLevels: readonly SelectOption[];
  readonly genders: readonly SelectOption[];
} {
  return {
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
  positionOptions,
  countries,
  emergencyContactProposal,
}: {
  locale: Locale;
  profile: OwnProfile;
  positionOptions: ClubPositions;
  countries: readonly CountryOption[];
  emergencyContactProposal: EmergencyContactProposal | null;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const router = useRouter();
  // La propuesta es para la primera vez: quien guardó ya decidió, aunque
  // fuera dejar el contacto vacío.
  const [guardian, setGuardian] = useState(() =>
    guardianProposalOf(translate, emergencyContactProposal),
  );
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile, guardian));
  const [auf, setAuf] = useState<OwnAuf>(profile.auf);
  // La posición guardada decide si la retirada se sigue ofreciendo: quien la
  // cambió y guardó ya no puede volver a ella.
  const [savedPositionId, setSavedPositionId] = useState(profile.positionId);
  const [issues, setIssues] = useState<LocalIssues>(NO_LOCAL_ISSUES);
  const [status, setStatus] = useState<Status>({ kind: "editing" });
  // El estado desactiva el botón en el siguiente pintado, pero un doble clic
  // llega antes. La referencia cambia en el acto.
  const isSendingRef = useRef(false);

  function update(change: Partial<Draft>): void {
    setDraft((current) => ({ ...current, ...change }));
    setIssues((current) => withoutIssuesOf(current, change));
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
    const submission = toSubmission(draft, auf, guardian);
    const localIssues = localIssuesOf(submission);
    if (hasLocalIssues(localIssues)) {
      setIssues(localIssues);
      return;
    }

    isSendingRef.current = true;
    setStatus({ kind: "sending" });
    const result = await saveOwnProfile(submission);
    isSendingRef.current = false;
    if (result.kind === "failed") {
      setStatus(result);
      return;
    }
    setDraft(toDraft(result.profile, null));
    setGuardian(null);
    setAuf(result.profile.auf);
    setSavedPositionId(result.profile.positionId);
    setStatus({ kind: "saved" });
    router.refresh();
  }

  const isSending = status.kind === "sending";
  const options = catalogOptions(translate);
  const positions = offeredPositions(positionOptions, savedPositionId).map(
    (position) => positionOption(translate, position),
  );
  return (
    <section className="auth-pending" aria-labelledby="mis-datos">
      <h2 id="mis-datos">{translate("account.profile.title")}</h2>
      <form className="auth-fields" onSubmit={handleSubmit} noValidate>
        <FullNameField
          translate={translate}
          value={draft.fullName}
          issue={issues.fullName}
          onChange={(fullName) => update({ fullName })}
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
          onChange={(country) => update({ country })}
        />
        {positions.length === 0 ? null : (
          <SelectField
            id="perfil-posicion"
            label={translate("account.profile.position")}
            value={draft.positionId}
            options={positions}
            emptyLabel={translate("account.profile.notSet")}
            onChange={(positionId) => update({ positionId })}
          />
        )}
        <SelectField
          id="perfil-nivel"
          label={translate("account.profile.experienceLevel")}
          value={draft.experienceLevel}
          options={options.experienceLevels}
          emptyLabel={translate("account.profile.notSet")}
          onChange={(experienceLevel) => update({ experienceLevel })}
        />
        <SelectField
          id="perfil-genero"
          label={translate("account.profile.gender")}
          value={draft.gender}
          options={options.genders}
          emptyLabel={translate("account.profile.notSet")}
          onChange={(gender) => update({ gender })}
        />
        <OwnAufSection
          translate={translate}
          locale={locale}
          auf={auf}
          draft={draft}
          numberIssueText={
            issues.aufNumber === null
              ? null
              : describeProfileIssue(translate, issues.aufNumber)
          }
          onChange={update}
        />
        <OwnContactSection
          translate={translate}
          draft={draft}
          issueTextOf={(field) => contactIssueText(translate, issues, field)}
          isGuardianProposed={guardian !== null}
          onChange={update}
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
