"use client";

import { useState } from "react";
import { type CardCell, CardCells } from "@/components/account/CardCells";
import { EmptyValue } from "@/components/account/DetailList";
import { CardForm, EditableCard } from "@/components/account/EditableCard";
import { useCardSubmission } from "@/components/account/use-card-submission";
import { ageOn } from "@/lib/auth/account-activation";
import { formatCalendarDay } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import {
  type MemberRecord,
  type MemberRecordSubmission,
  correctionRequiresGuardianConsent,
} from "@/lib/members/member-record";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import {
  type MemberRecordSave,
  describeMemberRecordFailure,
  describeMemberRecordIssue,
  saveMemberRecord,
} from "./member-record-client";
import { serverFieldIssueOf } from "./record-card-issues";
import { TextField } from "./record-fields";

/**
 * La Ficha del club de un socio (#272, #773, D2 del PRD de E30): la fecha de
 * nacimiento con su edad y la fecha de alta. El Admin corrige la de
 * nacimiento con Editar; la de alta sólo se lee, porque decide qué sesiones
 * cuentan en la asistencia.
 *
 * Guardar manda la fecha con los grupos tal como están guardados, porque la
 * API los pide siempre, y sin el AUF ni el contacto, que es no tocarlos. Sin
 * tocar no se manda nada.
 */

const HEADING_ID = "ficha-del-club";
const BIRTH_ID = "ficha-nacimiento";
const BIRTH_HINT_ID = "ficha-nacimiento-ayuda";
const GUARDIAN_NOTICE_ID = "ficha-nacimiento-tutor";
const BIRTH_FIELDS = ["dateOfBirth"] as const;

function toBirthSubmission(
  record: MemberRecord,
  dateOfBirth: string,
): MemberRecordSubmission {
  return {
    auf: null,
    groupIds: record.groups.map(({ id }) => id),
    dateOfBirth: dateOfBirth.trim() === "" ? null : dateOfBirth,
    contact: null,
  };
}

/** Si guardar la fecha que hay en el control dejaría al miembro pidiendo el
 * consentimiento de su tutor. Se avisa antes de guardar para que no sea una
 * sorpresa para nadie. Una fecha a medio escribir no avisa: el control de
 * fecha la entrega vacía hasta que está completa. */
function isGuardianNoticeDue(
  record: MemberRecord,
  dateOfBirth: string,
): boolean {
  return (
    dateOfBirth !== "" &&
    dateOfBirth !== record.dateOfBirth &&
    correctionRequiresGuardianConsent(record, dateOfBirth)
  );
}

function BirthValue({
  translate,
  dateOfBirth,
}: {
  translate: Translator;
  dateOfBirth: string;
}): React.JSX.Element {
  const age = ageOn(dateOfBirth, clubCalendarDate(new Date()));
  return (
    <>
      {formatCalendarDay(translate.locale, dateOfBirth)}{" "}
      <span className="profile-cell-extra">· {age}</span>
    </>
  );
}

function joinedCellOf(translate: Translator, record: MemberRecord): CardCell {
  return {
    label: translate("profileCard.clubRecord.joined"),
    value: formatCalendarDay(translate.locale, record.joinedOn),
  };
}

type ClubRecordEditorProps = {
  readonly translate: Translator;
  readonly locale: Locale;
  readonly record: MemberRecord;
  readonly onSaved: (record: MemberRecord) => void;
  readonly onCancel: () => void;
};

function ClubRecordEditor({
  translate,
  locale,
  record,
  onSaved,
  onCancel,
}: ClubRecordEditorProps): React.JSX.Element {
  const saved = record.dateOfBirth ?? "";
  const [dateOfBirth, setDateOfBirth] = useState(saved);
  const submission = useCardSubmission<MemberRecordSave>();

  function update(next: string): void {
    setDateOfBirth(next);
    submission.clearFailure();
  }

  function handleSubmit(): void {
    if (dateOfBirth === saved) {
      onCancel();
      return;
    }
    void submission.submit(
      () =>
        saveMemberRecord(record.userId, toBirthSubmission(record, dateOfBirth)),
      (result) => onSaved(result.record),
    );
  }

  const { status } = submission;
  const issue = serverFieldIssueOf(status, BIRTH_FIELDS);
  const isNoticeDue = isGuardianNoticeDue(record, dateOfBirth);
  return (
    <CardForm
      translate={translate}
      isSending={submission.isSending}
      // Un 400 de la fecha ya se enseña junto a ella.
      failureText={
        status.kind === "failed" && issue === null
          ? describeMemberRecordFailure(translate, status)
          : null
      }
      onSubmit={handleSubmit}
      onCancel={onCancel}
    >
      <TextField
        id={BIRTH_ID}
        label={translate("memberRecord.birth.label")}
        type="date"
        value={dateOfBirth}
        issueText={
          issue === null
            ? null
            : describeMemberRecordIssue(translate, {
                code: issue.code,
                locale,
                joinedOn: record.joinedOn,
              })
        }
        hintIds={
          isNoticeDue ? [GUARDIAN_NOTICE_ID, BIRTH_HINT_ID] : [BIRTH_HINT_ID]
        }
        onChange={update}
      />
      {isNoticeDue ? (
        <p className="member-record-warning" id={GUARDIAN_NOTICE_ID}>
          {translate("memberRecord.birth.guardianNotice", {
            name: record.fullName,
          })}
        </p>
      ) : null}
      <p className="auth-hint" id={BIRTH_HINT_ID}>
        {translate("memberRecord.birth.hint")}
      </p>
      <CardCells cells={[joinedCellOf(translate, record)]} />
    </CardForm>
  );
}

export function MemberRecordClubRecord({
  translate,
  locale,
  record,
  onSaved,
}: Omit<ClubRecordEditorProps, "onCancel">): React.JSX.Element {
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
      title={translate("profileCard.clubRecord.title")}
      isEditing={isEditing}
      focusFieldId={BIRTH_ID}
      savedText={isJustSaved ? translate("profileCard.clubRecord.saved") : null}
      isAdminOnly
      onEdit={handleEdit}
    >
      {isEditing ? (
        <ClubRecordEditor
          translate={translate}
          locale={locale}
          record={record}
          onSaved={handleSaved}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        <CardCells
          cells={[
            {
              label: translate("profileCard.clubRecord.dateOfBirth"),
              value:
                record.dateOfBirth === null ? (
                  <EmptyValue translate={translate} />
                ) : (
                  <BirthValue
                    translate={translate}
                    dateOfBirth={record.dateOfBirth}
                  />
                ),
            },
            joinedCellOf(translate, record),
          ]}
        />
      )}
    </EditableCard>
  );
}
