"use client";

import { useState } from "react";
import { ContactSummary } from "@/components/account/ContactSummary";
import { CardForm, EditableCard } from "@/components/account/EditableCard";
import {
  type ContactDraft,
  contactDraftOf,
  isSameContactDraft,
  toContactSubmission,
} from "@/components/account/OwnContactSection";
import {
  type CardSubmissionStatus,
  useCardSubmission,
} from "@/components/account/use-card-submission";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import type {
  MemberRecord,
  MemberRecordSubmission,
} from "@/lib/members/member-record";
import {
  type ContactField,
  type ContactIssue,
  type ContactIssueCode,
  type ProfileContactSubmission,
  contactIssuesOf,
  isContactIssueCode,
  isSamePhone,
} from "@/lib/members/profile-contact";
import {
  type MemberRecordFailure,
  type MemberRecordSave,
  describeMemberRecordFailure,
  describeMemberRecordIssue,
  readIssueCode,
  saveMemberRecord,
} from "./member-record-client";
import { TextField } from "./record-fields";

/**
 * El teléfono y el contacto de emergencia de un socio en su ficha (#499,
 * RF-3 del PRD de E19), en su tarjeta de Contacto (#772): el Admin los lee y,
 * con Editar, los corrige, por ejemplo si se los pasaron por mensaje. Son las
 * mismas reglas que el perfil propio (#496), con los textos escritos sobre el
 * socio y no sobre quien rellena.
 *
 * Guardar manda lo suyo con los grupos y la fecha de nacimiento tal como están
 * guardados, porque la API los pide siempre, y sin el AUF, que es no tocarlo.
 * Sin tocar no se manda nada: el socio puede haberlo cambiado desde que se
 * abrió la ficha, y mandar el de entonces lo pisaría.
 */

const HEADING_ID = "ficha-contacto";
const PHONE_ID = "ficha-telefono";
const EMERGENCY_HINT_ID = "ficha-emergencia-pista";
const SAME_PHONE_ID = "ficha-emergencia-mismo-telefono";

function recordContactDraftOf(record: MemberRecord): ContactDraft {
  return contactDraftOf(record, null);
}

function toRecordContactSubmission(
  record: MemberRecord,
  contact: ProfileContactSubmission,
): MemberRecordSubmission {
  return {
    auf: null,
    groupIds: record.groups.map(({ id }) => id),
    dateOfBirth: record.dateOfBirth,
    contact,
  };
}

/** El campo de cada aviso del contacto, para enseñar junto a él el rechazo
 * del servidor. La ficha completa los suyos con estos. */
export const FIELD_OF_CONTACT_ISSUE = {
  phone_invalid_characters: "phone",
  phone_too_short: "phone",
  phone_too_long: "phone",
  emergency_contact_name_missing: "emergencyContactName",
  emergency_contact_name_too_long: "emergencyContactName",
  emergency_contact_phone_missing: "emergencyContactPhone",
  emergency_contact_phone_invalid_characters: "emergencyContactPhone",
  emergency_contact_phone_too_short: "emergencyContactPhone",
  emergency_contact_phone_too_long: "emergencyContactPhone",
  emergency_contact_relationship_missing: "emergencyContactRelationship",
  emergency_contact_relationship_too_long: "emergencyContactRelationship",
} as const satisfies Record<ContactIssueCode, ContactField>;

/** El aviso de campo que trajo el envío, si el servidor rechazó un dato del
 * contacto. */
function serverIssueOf(
  status: CardSubmissionStatus<MemberRecordFailure>,
): ContactIssue | null {
  if (status.kind !== "failed") {
    return null;
  }
  const code = readIssueCode(status);
  return code !== null && isContactIssueCode(code)
    ? { field: FIELD_OF_CONTACT_ISSUE[code], code }
    : null;
}

function RecordContactFields({
  translate,
  fullName,
  draft,
  issueTextOf,
  onChange,
}: {
  translate: Translator;
  /** El nombre del socio, que los textos usan para no hablarle a quien
   * rellena. */
  fullName: string;
  draft: ContactDraft;
  /** El aviso de un campo, o null si no tiene ninguno. */
  issueTextOf: (field: ContactField) => string | null;
  onChange: (change: Partial<ContactDraft>) => void;
}): React.JSX.Element {
  const isOwnPhone = isSamePhone(draft.phone, draft.emergencyContactPhone);
  return (
    <>
      <TextField
        id={PHONE_ID}
        label={translate("memberRecord.contact.phone")}
        type="tel"
        value={draft.phone}
        issueText={issueTextOf("phone")}
        onChange={(phone) => onChange({ phone })}
      />
      <fieldset
        className="account-emergency-contact"
        aria-describedby={EMERGENCY_HINT_ID}
      >
        <legend>{translate("memberRecord.contact.emergencyLegend")}</legend>
        <p className="auth-hint" id={EMERGENCY_HINT_ID}>
          {translate("memberRecord.contact.emergencyHint", { name: fullName })}
        </p>
        <div className="profile-card-pair">
          <TextField
            id="ficha-emergencia-nombre"
            label={translate("memberRecord.contact.emergencyName")}
            type="text"
            value={draft.emergencyContactName}
            issueText={issueTextOf("emergencyContactName")}
            onChange={(emergencyContactName) =>
              onChange({ emergencyContactName })
            }
          />
          <TextField
            id="ficha-emergencia-relacion"
            label={translate("memberRecord.contact.emergencyRelationship")}
            type="text"
            value={draft.emergencyContactRelationship}
            issueText={issueTextOf("emergencyContactRelationship")}
            onChange={(emergencyContactRelationship) =>
              onChange({ emergencyContactRelationship })
            }
          />
        </div>
        <TextField
          id="ficha-emergencia-telefono"
          label={translate("memberRecord.contact.emergencyPhone")}
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
            {translate("memberRecord.contact.samePhone", { name: fullName })}
          </p>
        ) : null}
      </fieldset>
    </>
  );
}

type RecordContactEditorProps = {
  readonly translate: Translator;
  readonly locale: Locale;
  readonly record: MemberRecord;
  readonly onSaved: (record: MemberRecord) => void;
  readonly onCancel: () => void;
};

function RecordContactEditor({
  translate,
  locale,
  record,
  onSaved,
  onCancel,
}: RecordContactEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState(() => recordContactDraftOf(record));
  const [issues, setIssues] = useState<readonly ContactIssue[]>([]);
  const submission = useCardSubmission<MemberRecordSave>();

  function update(change: Partial<ContactDraft>): void {
    setDraft((current) => ({ ...current, ...change }));
    setIssues([]);
    submission.clearFailure();
  }

  function handleSubmit(): void {
    // Sin tocar no hay nada que mandar: guardar es cerrar, como Cancelar.
    if (isSameContactDraft(draft, recordContactDraftOf(record))) {
      onCancel();
      return;
    }
    const contact = toContactSubmission(draft, null);
    const localIssues = contactIssuesOf(contact);
    if (localIssues.length > 0) {
      setIssues(localIssues);
      return;
    }
    void submission.submit(
      () =>
        saveMemberRecord(
          record.userId,
          toRecordContactSubmission(record, contact),
        ),
      (result) => onSaved(result.record),
    );
  }

  const { status } = submission;
  const serverIssue = serverIssueOf(status);
  const fieldIssues = serverIssue === null ? issues : [serverIssue];

  function issueTextOf(field: ContactField): string | null {
    const issue = fieldIssues.find((candidate) => candidate.field === field);
    return issue === undefined
      ? null
      : describeMemberRecordIssue(translate, {
          code: issue.code,
          locale,
          joinedOn: record.joinedOn,
        });
  }

  return (
    <CardForm
      translate={translate}
      isSending={submission.isSending}
      // Un 400 de un campo ya se enseña junto a ese campo.
      failureText={
        status.kind === "failed" && serverIssue === null
          ? describeMemberRecordFailure(translate, status)
          : null
      }
      onSubmit={handleSubmit}
      onCancel={onCancel}
    >
      <RecordContactFields
        translate={translate}
        fullName={record.fullName}
        draft={draft}
        issueTextOf={issueTextOf}
        onChange={update}
      />
    </CardForm>
  );
}

export function MemberRecordContact({
  translate,
  locale,
  record,
  onSaved,
}: Omit<RecordContactEditorProps, "onCancel">): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [isJustSaved, setIsJustSaved] = useState(false);

  function handleEdit(): void {
    setIsJustSaved(false);
    setIsEditing(true);
  }

  function handleSaved(saved: MemberRecord): void {
    setIsEditing(false);
    setIsJustSaved(true);
    onSaved(saved);
  }

  return (
    <EditableCard
      translate={translate}
      headingId={HEADING_ID}
      title={translate("memberRecord.contact.title")}
      isEditing={isEditing}
      focusFieldId={PHONE_ID}
      savedText={isJustSaved ? translate("profileCard.contact.saved") : null}
      onEdit={handleEdit}
    >
      {isEditing ? (
        <RecordContactEditor
          translate={translate}
          locale={locale}
          record={record}
          onSaved={handleSaved}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        <ContactSummary
          translate={translate}
          reachableAt={{ phone: record.phone, email: record.email }}
          emergencyContact={record.emergencyContact}
        />
      )}
    </EditableCard>
  );
}
