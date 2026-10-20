"use client";

import { useState } from "react";
import { AufCells } from "@/components/account/AufCells";
import { CardForm, EditableCard } from "@/components/account/EditableCard";
import { useCardSubmission } from "@/components/account/use-card-submission";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import {
  type MemberRecord,
  type MemberRecordSubmission,
  isAufNumberTooLong,
} from "@/lib/members/member-record";
import type { OwnAuf } from "@/lib/members/own-profile";
import {
  type MemberRecordSave,
  describeMemberRecordFailure,
  describeMemberRecordIssue,
  saveMemberRecord,
} from "./member-record-client";
import {
  type RecordFieldIssue,
  serverFieldIssueOf,
} from "./record-card-issues";
import { TextField } from "./record-fields";

/**
 * El AUF de un socio en su ficha (#242), en su tarjeta de Registro AUF
 * (#773): el Admin lo lee en tres celdas y, con Editar, corrige el número y el
 * vencimiento. Lo que guarda el Admin queda verificado.
 *
 * Guardar manda el AUF con los grupos y la fecha de nacimiento tal como están
 * guardados, porque la API los pide siempre, y sin el contacto. Sin tocar no
 * se manda nada (#274): el socio puede haberlo cambiado desde que se abrió la
 * ficha, y mandar el de entonces lo pisaría verificado.
 *
 * Dice si hay cambios sin guardar: mientras los haya, la franja de Verificar
 * AUF no ofrece verificar, porque guardar ya lo deja verificado.
 */

const HEADING_ID = "ficha-auf";
const AUF_NUMBER_ID = "ficha-auf-numero";
const AUF_EXPIRY_ID = "ficha-auf-vencimiento";
const AUF_HINT_ID = "ficha-auf-ayuda";

const AUF_FIELDS = ["aufNumber", "aufExpiry"] as const;
type AufField = (typeof AUF_FIELDS)[number];

/** Lo que hay en los controles. Una cadena vacía es "sin valor", y se manda
 * como null. */
type AufDraft = Readonly<Record<AufField, string>>;

function aufDraftOf(record: MemberRecord): AufDraft {
  return {
    aufNumber: record.aufNumber ?? "",
    aufExpiry: record.aufExpiry ?? "",
  };
}

function isSameAufDraft(left: AufDraft, right: AufDraft): boolean {
  return (
    left.aufNumber === right.aufNumber && left.aufExpiry === right.aufExpiry
  );
}

function orNull(value: string): string | null {
  return value.trim() === "" ? null : value;
}

function toAufSubmission(
  record: MemberRecord,
  draft: AufDraft,
): MemberRecordSubmission {
  return {
    auf: {
      aufNumber: orNull(draft.aufNumber),
      aufExpiry: orNull(draft.aufExpiry),
    },
    groupIds: record.groups.map(({ id }) => id),
    dateOfBirth: record.dateOfBirth,
    contact: null,
  };
}

/** La ficha dice el AUF como el perfil, para leerlo con las mismas celdas. */
function recordAufOf(record: MemberRecord): OwnAuf {
  if (record.aufNumber === null) {
    return { status: "none" };
  }
  return {
    status: record.isAufVerified ? "verified" : "pending",
    number: record.aufNumber,
    expiry: record.aufExpiry,
  };
}

type RecordAufEditorProps = {
  readonly translate: Translator;
  readonly locale: Locale;
  readonly record: MemberRecord;
  readonly onSaved: (record: MemberRecord) => void;
  readonly onCancel: () => void;
  readonly onChanges: (hasChanges: boolean) => void;
};

function RecordAufEditor({
  translate,
  locale,
  record,
  onSaved,
  onCancel,
  onChanges,
}: RecordAufEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState(() => aufDraftOf(record));
  const [localIssue, setLocalIssue] =
    useState<RecordFieldIssue<AufField> | null>(null);
  const submission = useCardSubmission<MemberRecordSave>();

  function update(change: Partial<AufDraft>): void {
    const next = { ...draft, ...change };
    setDraft(next);
    setLocalIssue(null);
    submission.clearFailure();
    onChanges(!isSameAufDraft(next, aufDraftOf(record)));
  }

  function handleSubmit(): void {
    if (isSameAufDraft(draft, aufDraftOf(record))) {
      onCancel();
      return;
    }
    if (isAufNumberTooLong(draft.aufNumber)) {
      setLocalIssue({ field: "aufNumber", code: "auf_number_too_long" });
      return;
    }
    void submission.submit(
      () => saveMemberRecord(record.userId, toAufSubmission(record, draft)),
      (result) => onSaved(result.record),
    );
  }

  const { status } = submission;
  const serverIssue = serverFieldIssueOf(status, AUF_FIELDS);
  const issue = localIssue ?? serverIssue;

  function issueTextOf(field: AufField): string | null {
    return issue === null || issue.field !== field
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
      <div className="profile-card-pair">
        <TextField
          id={AUF_NUMBER_ID}
          label={translate("memberRecord.auf.number")}
          type="text"
          value={draft.aufNumber}
          issueText={issueTextOf("aufNumber")}
          hintIds={[AUF_HINT_ID]}
          onChange={(aufNumber) => update({ aufNumber })}
        />
        <TextField
          id={AUF_EXPIRY_ID}
          label={translate("memberRecord.auf.expiry")}
          type="date"
          value={draft.aufExpiry}
          issueText={issueTextOf("aufExpiry")}
          onChange={(aufExpiry) => update({ aufExpiry })}
        />
      </div>
      <p className="auth-hint" id={AUF_HINT_ID}>
        {translate("memberRecord.auf.hint")}
      </p>
    </CardForm>
  );
}

export function MemberRecordAuf({
  translate,
  locale,
  record,
  onSaved,
  onChanges,
}: Omit<RecordAufEditorProps, "onCancel">): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [isJustSaved, setIsJustSaved] = useState(false);

  function handleEdit(): void {
    setIsJustSaved(false);
    setIsEditing(true);
  }

  function close(): void {
    setIsEditing(false);
    onChanges(false);
  }

  function handleSaved(saved: MemberRecord): void {
    close();
    setIsJustSaved(true);
    onSaved(saved);
  }

  return (
    <EditableCard
      translate={translate}
      headingId={HEADING_ID}
      title={translate("memberRecord.auf.title")}
      isEditing={isEditing}
      focusFieldId={AUF_NUMBER_ID}
      savedText={isJustSaved ? translate("profileCard.auf.saved") : null}
      isAdminOnly
      onEdit={handleEdit}
    >
      {isEditing ? (
        <RecordAufEditor
          translate={translate}
          locale={locale}
          record={record}
          onSaved={handleSaved}
          onCancel={close}
          onChanges={onChanges}
        />
      ) : (
        <AufCells translate={translate} auf={recordAufOf(record)} />
      )}
    </EditableCard>
  );
}
