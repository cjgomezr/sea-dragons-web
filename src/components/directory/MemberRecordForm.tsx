"use client";

import { useRef, useState } from "react";
import { MemberAvatar } from "@/components/MemberAvatar";
import type { Group } from "@/lib/groups/groups";
import { formatCalendarDay } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import {
  type MemberRecord,
  type MemberRecordIssueCode,
  type MemberRecordSubmission,
  correctionRequiresGuardianConsent,
  isAufNumberTooLong,
} from "@/lib/members/member-record";
import { aufMarksOf } from "./auf-marks";
import { GroupsField, TextField } from "./record-fields";
import {
  type MemberRecordFailure,
  type MemberRecordSave,
  describeMemberRecordFailure,
  describeMemberRecordIssue,
  readIssueCode,
  saveMemberRecord,
  verifyMemberRecordAuf,
} from "./member-record-client";

/**
 * El formulario de la ficha reservada al Admin (#242): número de AUF,
 * vencimiento, grupos y fecha de nacimiento (#272), guardados juntos en una
 * sola petición para que dos Admin a la vez no dejen la fila a medias.
 *
 * Da un cambio por hecho sólo cuando el servidor lo confirma, y entonces
 * enseña lo que el servidor guardó, no lo que se escribió: si el número se
 * borró, el vencimiento también desaparece.
 *
 * Un AUF que escribió el miembro llega sin verificar (#274). El Admin lo
 * verifica con su botón, que manda el AUF guardado y no el de los controles;
 * por eso el botón desaparece en cuanto el número o el vencimiento se editan:
 * entonces guardar ya lo deja verificado.
 */

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "sending" }
  | { readonly kind: "verifying" }
  | { readonly kind: "saved" }
  | { readonly kind: "aufVerified" }
  | MemberRecordFailure;

/** Lo que hay en los controles. Una cadena vacía es "sin valor", y se manda
 * como null. */
type Draft = {
  readonly aufNumber: string;
  readonly aufExpiry: string;
  readonly groupIds: ReadonlySet<string>;
  readonly dateOfBirth: string;
};

/** Un aviso que va junto a su campo y no en el aviso general. */
type FieldIssue = {
  readonly field: "aufNumber" | "aufExpiry" | "dateOfBirth";
  readonly code: MemberRecordIssueCode;
};

const AUF_NUMBER_ID = "ficha-auf-numero";
const AUF_EXPIRY_ID = "ficha-auf-vencimiento";
const AUF_HINT_ID = "ficha-auf-ayuda";
const AUF_PENDING_ID = "ficha-auf-pendiente";
const BIRTH_ID = "ficha-nacimiento";
const BIRTH_HINT_ID = "ficha-nacimiento-ayuda";
const GUARDIAN_NOTICE_ID = "ficha-nacimiento-tutor";
/** El mismo círculo, y la misma clase, que la cabecera del perfil propio
 * (#354). */
const RECORD_AVATAR_SIZE = 64;

function toDraft(record: MemberRecord): Draft {
  return {
    aufNumber: record.aufNumber ?? "",
    aufExpiry: record.aufExpiry ?? "",
    groupIds: new Set(record.groups.map((group) => group.id)),
    dateOfBirth: record.dateOfBirth ?? "",
  };
}

function orNull(value: string): string | null {
  return value.trim() === "" ? null : value;
}

/** Si los controles siguen enseñando el AUF guardado. */
function isAufUntouched(record: MemberRecord, draft: Draft): boolean {
  return (
    draft.aufNumber === (record.aufNumber ?? "") &&
    draft.aufExpiry === (record.aufExpiry ?? "")
  );
}

/** Un AUF sin tocar no se manda: el miembro puede haberlo cambiado desde
 * que se abrió la ficha, y mandar el de entonces lo pisaría verificado. */
function toSubmission(
  draft: Draft,
  record: MemberRecord,
): MemberRecordSubmission {
  return {
    auf: isAufUntouched(record, draft)
      ? null
      : {
          aufNumber: orNull(draft.aufNumber),
          aufExpiry: orNull(draft.aufExpiry),
        },
    groupIds: [...draft.groupIds],
    dateOfBirth: orNull(draft.dateOfBirth),
  };
}

const FIELD_OF_ISSUE: Readonly<
  Record<MemberRecordIssueCode, FieldIssue["field"]>
> = {
  auf_number_too_long: "aufNumber",
  auf_expiry_not_a_date: "aufExpiry",
  auf_expiry_before_joined: "aufExpiry",
  date_of_birth_not_a_date: "dateOfBirth",
  date_of_birth_in_future: "dateOfBirth",
  date_of_birth_too_early: "dateOfBirth",
  date_of_birth_required: "dateOfBirth",
};

function toFieldIssue(code: MemberRecordIssueCode): FieldIssue {
  return { field: FIELD_OF_ISSUE[code], code };
}

function SaveOutcome({
  translate,
  status,
}: {
  translate: Translator;
  status: Status;
}): React.JSX.Element | null {
  if (status.kind === "saved" || status.kind === "aufVerified") {
    return (
      <p className="auth-note" role="status">
        {translate(
          status.kind === "saved"
            ? "memberRecord.saved"
            : "memberRecord.auf.verified",
        )}
      </p>
    );
  }
  // Un 400 de un campo ya se enseña junto a ese campo.
  if (status.kind === "failed" && readIssueCode(status) === null) {
    return (
      <p className="auth-error" role="alert">
        {describeMemberRecordFailure(translate, status)}
      </p>
    );
  }
  return null;
}

function RecordHeader({
  translate,
  locale,
  record,
}: {
  translate: Translator;
  locale: Locale;
  record: MemberRecord;
}): React.JSX.Element {
  const marks = aufMarksOf(translate, record);
  return (
    <header className="member-record-header">
      <div className="member-record-identity">
        <MemberAvatar
          className="account-avatar"
          fullName={record.fullName}
          photoUrl={record.photoUrl}
          size={RECORD_AVATAR_SIZE}
          alt={translate("memberRecord.photoAlt", { name: record.fullName })}
        />
        <h1>{record.fullName}</h1>
      </div>
      <p className="app-lead">{translate("memberRecord.lead")}</p>
      <p className="member-record-joined">
        {translate("memberRecord.joinedOn", {
          date: formatCalendarDay(locale, record.joinedOn),
        })}
      </p>
      {marks.length === 0 ? null : (
        <span className="directory-marks">
          {marks.map((mark) => (
            <span
              key={mark.text}
              className={`directory-mark directory-mark-${mark.tone}`}
            >
              {mark.text}
            </span>
          ))}
        </span>
      )}
    </header>
  );
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

function DateOfBirthSection({
  translate,
  record,
  value,
  issueText,
  onChange,
}: {
  translate: Translator;
  record: MemberRecord;
  value: string;
  issueText: string | null;
  onChange: (dateOfBirth: string) => void;
}): React.JSX.Element {
  const isNoticeDue = isGuardianNoticeDue(record, value);
  return (
    <section className="auth-fields" aria-labelledby="ficha-nacimiento-titulo">
      <h2 id="ficha-nacimiento-titulo">
        {translate("memberRecord.birth.title")}
      </h2>
      <TextField
        id={BIRTH_ID}
        label={translate("memberRecord.birth.label")}
        type="date"
        value={value}
        issueText={issueText}
        hintIds={
          isNoticeDue ? [GUARDIAN_NOTICE_ID, BIRTH_HINT_ID] : [BIRTH_HINT_ID]
        }
        onChange={onChange}
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
    </section>
  );
}

function isAufPending(record: MemberRecord): boolean {
  return record.aufNumber !== null && !record.isAufVerified;
}

function AufVerification({
  translate,
  isVerifying,
  canVerify,
  onVerify,
}: {
  translate: Translator;
  isVerifying: boolean;
  /** Sólo el AUF guardado se verifica: con los controles editados, no. */
  canVerify: boolean;
  onVerify: () => void;
}): React.JSX.Element {
  return (
    <>
      <p className="member-record-warning" id={AUF_PENDING_ID}>
        {translate("memberRecord.auf.pending")}
      </p>
      {canVerify ? (
        <button
          type="button"
          className="auth-secondary"
          aria-describedby={AUF_PENDING_ID}
          onClick={onVerify}
        >
          {translate(
            isVerifying
              ? "memberRecord.auf.verifying"
              : "memberRecord.auf.verify",
          )}
        </button>
      ) : null}
    </>
  );
}

/** El aviso de campo que trajo el último envío, si el servidor rechazó uno. */
function serverIssueOf(status: Status): FieldIssue | null {
  if (status.kind !== "failed") {
    return null;
  }
  const code = readIssueCode(status);
  return code === null ? null : toFieldIssue(code);
}

export function MemberRecordForm({
  locale,
  record: initialRecord,
  clubGroups,
}: {
  locale: Locale;
  record: MemberRecord;
  clubGroups: readonly Group[];
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [record, setRecord] = useState(initialRecord);
  const [draft, setDraft] = useState<Draft>(() => toDraft(initialRecord));
  const [status, setStatus] = useState<Status>({ kind: "editing" });
  const [localIssue, setLocalIssue] = useState<FieldIssue | null>(null);
  // El estado desactiva el botón en el siguiente pintado, pero un doble clic
  // llega antes. La referencia cambia en el acto.
  const isSendingRef = useRef(false);

  function update(change: Partial<Draft>): void {
    setDraft((current) => ({ ...current, ...change }));
    setLocalIssue(null);
    // Un aviso habla del envío anterior. Mientras se envía no se toca, o el
    // botón volvería a activarse.
    setStatus((current) =>
      current.kind === "sending" ? current : { kind: "editing" },
    );
  }

  function toggleGroup(groupId: string, isChosen: boolean): void {
    const groupIds = new Set(draft.groupIds);
    if (isChosen) {
      groupIds.add(groupId);
    } else {
      groupIds.delete(groupId);
    }
    update({ groupIds });
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (isSendingRef.current) {
      return;
    }
    if (isAufNumberTooLong(draft.aufNumber)) {
      setLocalIssue(toFieldIssue("auf_number_too_long"));
      return;
    }
    await send("sending", () =>
      saveMemberRecord(record.userId, toSubmission(draft, record)),
    );
  }

  /** Guardar y verificar comparten el candado y el desenlace: los dos
   * devuelven la ficha tal como quedó. */
  async function send(
    kind: "sending" | "verifying",
    request: () => Promise<MemberRecordSave>,
  ): Promise<void> {
    isSendingRef.current = true;
    setStatus({ kind });
    const result = await request();
    isSendingRef.current = false;
    if (result.kind === "failed") {
      setStatus(result);
      return;
    }
    setRecord(result.record);
    setDraft(toDraft(result.record));
    setStatus({ kind: kind === "sending" ? "saved" : "aufVerified" });
  }

  async function handleVerify(): Promise<void> {
    if (isSendingRef.current || record.aufNumber === null) {
      return;
    }
    const shown = { aufNumber: record.aufNumber, aufExpiry: record.aufExpiry };
    await send("verifying", () => verifyMemberRecordAuf(record.userId, shown));
  }

  const issue = localIssue ?? serverIssueOf(status);
  const issueTextFor = (field: FieldIssue["field"]): string | null =>
    issue?.field === field
      ? describeMemberRecordIssue(translate, {
          code: issue.code,
          locale,
          joinedOn: record.joinedOn,
        })
      : null;
  const isSending = status.kind === "sending" || status.kind === "verifying";

  return (
    <>
      <RecordHeader translate={translate} locale={locale} record={record} />
      <form
        className="auth-pending member-record-form"
        onSubmit={handleSubmit}
        noValidate
      >
        {/* Mientras se guarda no se edita: lo que se escribiera ahora lo
            pisaría la ficha que devuelva el servidor. */}
        <fieldset className="member-record-fields" disabled={isSending}>
          <section className="auth-fields" aria-labelledby="ficha-auf">
            <h2 id="ficha-auf">{translate("memberRecord.auf.title")}</h2>
            <TextField
              id={AUF_NUMBER_ID}
              label={translate("memberRecord.auf.number")}
              type="text"
              value={draft.aufNumber}
              issueText={issueTextFor("aufNumber")}
              hintIds={[AUF_HINT_ID]}
              onChange={(aufNumber) => update({ aufNumber })}
            />
            <TextField
              id={AUF_EXPIRY_ID}
              label={translate("memberRecord.auf.expiry")}
              type="date"
              value={draft.aufExpiry}
              issueText={issueTextFor("aufExpiry")}
              onChange={(aufExpiry) => update({ aufExpiry })}
            />
            <p className="auth-hint" id={AUF_HINT_ID}>
              {translate("memberRecord.auf.hint")}
            </p>
            {isAufPending(record) ? (
              <AufVerification
                translate={translate}
                isVerifying={status.kind === "verifying"}
                canVerify={isAufUntouched(record, draft)}
                onVerify={handleVerify}
              />
            ) : null}
          </section>
          <DateOfBirthSection
            translate={translate}
            record={record}
            value={draft.dateOfBirth}
            issueText={issueTextFor("dateOfBirth")}
            onChange={(dateOfBirth) => update({ dateOfBirth })}
          />
          <GroupsField
            translate={translate}
            clubGroups={clubGroups}
            chosen={draft.groupIds}
            onToggle={toggleGroup}
          />
        </fieldset>
        <SaveOutcome translate={translate} status={status} />
        <button type="submit" className="auth-submit" disabled={isSending}>
          {translate(
            status.kind === "sending"
              ? "memberRecord.saving"
              : "memberRecord.save",
          )}
        </button>
      </form>
    </>
  );
}
