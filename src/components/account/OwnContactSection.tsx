"use client";

import { useState } from "react";
import { TextField } from "@/components/directory/record-fields";
import type { Translator } from "@/lib/i18n/translator";
import type {
  OwnProfile,
  OwnProfileSubmission,
} from "@/lib/members/own-profile";
import {
  type ContactField,
  type ContactIssue,
  type EmergencyContact,
  type ProfileContact,
  type ProfileContactSubmission,
  contactIssuesOf,
  isSamePhone,
} from "@/lib/members/profile-contact";
import { ContactSummary } from "./ContactSummary";
import { CardForm, EditableCard } from "./EditableCard";
import {
  type ProfileSaveResult,
  describeProfileFailure,
  describeProfileIssue,
  saveOwnProfile,
} from "./profile-client";
import { useCardSubmission } from "./use-card-submission";

/**
 * El teléfono y el contacto de emergencia del perfil propio (#496), en su
 * tarjeta de Contacto (#772): se leen primero y se editan aparte. Los dos son
 * opcionales; el contacto va entero o no va, y el aviso de cada dato que falta
 * va junto a él. Que el contacto tenga el teléfono propio no se impide: se
 * avisa, porque quien llame en una emergencia necesita a otra persona.
 *
 * Guardar manda lo suyo con Sobre mí tal como está guardado y sin el AUF, que
 * es no tocarlo: la API pide los campos del perfil siempre.
 */

/** El título de la tarjeta: el aviso del contacto (#498) lleva aquí. */
export const CONTACT_SECTION_ID = "perfil-contacto";
/** Los primeros campos de cada dato: la franja de lo que falta (#771) pone
 * ahí el foco. */
export const PHONE_ID = "perfil-telefono";
export const EMERGENCY_NAME_ID = "perfil-emergencia-nombre";
const EMERGENCY_HINT_ID = "perfil-emergencia-pista";
const GUARDIAN_PROPOSED_ID = "perfil-emergencia-tutor";
const SAME_PHONE_ID = "perfil-emergencia-mismo-telefono";

/** Lo que hay en los controles, con el nombre del campo al que se refiere
 * cada aviso. */
export type ContactDraft = Readonly<Record<ContactField, string>>;

/** Lo que el formulario propone a quien no tiene contacto: su tutor, con la
 * relación ya en el idioma de la pantalla y sin teléfono, porque del tutor
 * sólo se guarda el correo. */
export type GuardianProposal = Omit<EmergencyContact, "phone">;

export function contactDraftOf(
  contact: ProfileContact,
  proposal: GuardianProposal | null,
): ContactDraft {
  const emergency = contact.emergencyContact ?? {
    name: proposal === null ? "" : proposal.name,
    phone: "",
    relationship: proposal === null ? "" : proposal.relationship,
  };
  return {
    phone: contact.phone ?? "",
    emergencyContactName: emergency.name,
    emergencyContactPhone: emergency.phone,
    emergencyContactRelationship: emergency.relationship,
  };
}

export function isSameContactDraft(
  left: ContactDraft,
  right: ContactDraft,
): boolean {
  return (
    left.phone === right.phone &&
    left.emergencyContactName === right.emergencyContactName &&
    left.emergencyContactPhone === right.emergencyContactPhone &&
    left.emergencyContactRelationship === right.emergencyContactRelationship
  );
}

/** La propuesta del tutor tal como se rellenó, sin que el socio la tocara. */
function isUntouchedProposal(
  draft: ContactDraft,
  proposal: GuardianProposal | null,
): boolean {
  return (
    proposal !== null &&
    draft.emergencyContactPhone.trim() === "" &&
    draft.emergencyContactName === proposal.name &&
    draft.emergencyContactRelationship === proposal.relationship
  );
}

/** Un teléfono vacío va como null, y un contacto con los tres datos vacíos
 * también. A medias va tal cual, para que el dominio diga qué falta. La
 * propuesta del tutor sin tocar va como null: es nuestra, no del socio, y no
 * debe impedirle guardar su teléfono. */
export function toContactSubmission(
  draft: ContactDraft,
  proposal: GuardianProposal | null,
): ProfileContactSubmission {
  const emergencyContact = {
    name: draft.emergencyContactName,
    phone: draft.emergencyContactPhone,
    relationship: draft.emergencyContactRelationship,
  };
  const isEmergencyEmpty = Object.values(emergencyContact).every(
    (value) => value.trim() === "",
  );
  return {
    phone: draft.phone.trim() === "" ? null : draft.phone,
    emergencyContact:
      isEmergencyEmpty || isUntouchedProposal(draft, proposal)
        ? null
        : emergencyContact,
  };
}

function toOwnContactSubmission(
  contact: ProfileContactSubmission,
  profile: OwnProfile,
): OwnProfileSubmission {
  return {
    fullName: profile.fullName,
    country: profile.country ?? "",
    positionId: profile.positionId,
    experienceLevel: profile.experienceLevel,
    gender: profile.gender,
    ...contact,
    auf: null,
  };
}

function OwnContactFields({
  translate,
  draft,
  issueTextOf,
  isGuardianProposed,
  onChange,
}: {
  translate: Translator;
  draft: ContactDraft;
  /** El aviso de un campo, o null si no tiene ninguno. */
  issueTextOf: (field: ContactField) => string | null;
  /** El formulario rellenó al tutor (FR-082) porque no había contacto. */
  isGuardianProposed: boolean;
  onChange: (change: Partial<ContactDraft>) => void;
}): React.JSX.Element {
  const isOwnPhone = isSamePhone(draft.phone, draft.emergencyContactPhone);
  const groupHintIds = isGuardianProposed
    ? [EMERGENCY_HINT_ID, GUARDIAN_PROPOSED_ID]
    : [EMERGENCY_HINT_ID];
  return (
    <>
      <TextField
        id={PHONE_ID}
        label={translate("account.profile.contact.phone")}
        type="tel"
        autoComplete="tel"
        value={draft.phone}
        issueText={issueTextOf("phone")}
        onChange={(phone) => onChange({ phone })}
      />
      <fieldset
        className="account-emergency-contact"
        aria-describedby={groupHintIds.join(" ")}
      >
        <legend>{translate("account.profile.contact.emergencyLegend")}</legend>
        <p className="auth-hint" id={EMERGENCY_HINT_ID}>
          {translate("account.profile.contact.emergencyHint")}
        </p>
        {isGuardianProposed ? (
          <p className="auth-hint" id={GUARDIAN_PROPOSED_ID}>
            {translate("account.profile.contact.guardianProposed")}
          </p>
        ) : null}
        <div className="profile-card-pair">
          <TextField
            id={EMERGENCY_NAME_ID}
            label={translate("account.profile.contact.emergencyName")}
            type="text"
            value={draft.emergencyContactName}
            issueText={issueTextOf("emergencyContactName")}
            onChange={(emergencyContactName) =>
              onChange({ emergencyContactName })
            }
          />
          <TextField
            id="perfil-emergencia-relacion"
            label={translate("account.profile.contact.emergencyRelationship")}
            type="text"
            value={draft.emergencyContactRelationship}
            issueText={issueTextOf("emergencyContactRelationship")}
            onChange={(emergencyContactRelationship) =>
              onChange({ emergencyContactRelationship })
            }
          />
        </div>
        <TextField
          id="perfil-emergencia-telefono"
          label={translate("account.profile.contact.emergencyPhone")}
          type="tel"
          value={draft.emergencyContactPhone}
          issueText={issueTextOf("emergencyContactPhone")}
          hintIds={isOwnPhone ? [SAME_PHONE_ID] : []}
          onChange={(emergencyContactPhone) =>
            onChange({ emergencyContactPhone })
          }
        />
        {isOwnPhone ? (
          <p className="auth-hint" id={SAME_PHONE_ID}>
            {translate("account.profile.contact.samePhone")}
          </p>
        ) : null}
      </fieldset>
    </>
  );
}

type OwnContactEditorProps = {
  readonly translate: Translator;
  readonly profile: OwnProfile;
  /** El tutor que se propone mientras el socio no haya guardado su contacto. */
  readonly guardian: GuardianProposal | null;
  readonly onSaved: (profile: OwnProfile) => void;
  readonly onCancel: () => void;
  readonly onChanges: (hasChanges: boolean) => void;
};

function OwnContactEditor({
  translate,
  profile,
  guardian,
  onSaved,
  onCancel,
  onChanges,
}: OwnContactEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState(() => contactDraftOf(profile, guardian));
  const [issues, setIssues] = useState<readonly ContactIssue[]>([]);
  const submission = useCardSubmission<ProfileSaveResult>();

  function update(change: Partial<ContactDraft>): void {
    const next = { ...draft, ...change };
    setDraft(next);
    // Editar un campo borra su aviso y deja los demás.
    setIssues((current) => current.filter(({ field }) => !(field in change)));
    submission.clearFailure();
    onChanges(!isSameContactDraft(next, contactDraftOf(profile, guardian)));
  }

  function handleSubmit(): void {
    const contact = toContactSubmission(draft, guardian);
    const localIssues = contactIssuesOf(contact);
    if (localIssues.length > 0) {
      setIssues(localIssues);
      return;
    }
    void submission.submit(
      () => saveOwnProfile(toOwnContactSubmission(contact, profile)),
      (result) => onSaved(result.profile),
    );
  }

  function issueTextOf(field: ContactField): string | null {
    const issue = issues.find((candidate) => candidate.field === field);
    return issue === undefined
      ? null
      : describeProfileIssue(translate, issue.code);
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
      <OwnContactFields
        translate={translate}
        draft={draft}
        issueTextOf={issueTextOf}
        isGuardianProposed={guardian !== null}
        onChange={update}
      />
    </CardForm>
  );
}

export function OwnContactCard({
  email,
  isEditing,
  focusFieldId,
  savedText,
  onEdit,
  ...editor
}: OwnContactEditorProps & {
  readonly email: string;
  readonly isEditing: boolean;
  readonly focusFieldId: string;
  readonly savedText: string | null;
  readonly onEdit: () => void;
}): React.JSX.Element {
  const { translate, profile } = editor;
  return (
    <EditableCard
      translate={translate}
      headingId={CONTACT_SECTION_ID}
      title={translate("account.profile.contact.title")}
      isEditing={isEditing}
      focusFieldId={focusFieldId}
      savedText={savedText}
      onEdit={onEdit}
    >
      {isEditing ? (
        <OwnContactEditor {...editor} />
      ) : (
        <ContactSummary
          translate={translate}
          phone={profile.phone}
          email={email}
          emergencyContact={profile.emergencyContact}
        />
      )}
    </EditableCard>
  );
}
