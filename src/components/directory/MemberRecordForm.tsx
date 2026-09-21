"use client";

import { useRef, useState } from "react";
import type { Group } from "@/lib/groups/groups";
import { formatCalendarDay } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import {
  type MemberRecord,
  type MemberRecordIssueCode,
  type MemberRecordSubmission,
  isAufNumberTooLong,
} from "@/lib/members/member-record";
import {
  type MemberRecordFailure,
  describeMemberRecordFailure,
  describeMemberRecordIssue,
  readIssueCode,
  saveMemberRecord,
} from "./member-record-client";

/**
 * El formulario de la ficha reservada al Admin (#242): número de AUF,
 * vencimiento y grupos, guardados juntos en una sola petición para que dos
 * Admin a la vez no dejen la fila a medias.
 *
 * Da un cambio por hecho sólo cuando el servidor lo confirma, y entonces
 * enseña lo que el servidor guardó, no lo que se escribió: si el número se
 * borró, el vencimiento también desaparece.
 */

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "sending" }
  | { readonly kind: "saved" }
  | MemberRecordFailure;

/** Lo que hay en los controles. Una cadena vacía es "sin valor", y se manda
 * como null. */
type Draft = {
  readonly aufNumber: string;
  readonly aufExpiry: string;
  readonly groupIds: ReadonlySet<string>;
};

/** Un aviso que va junto a su campo y no en el aviso general. */
type FieldIssue = {
  readonly field: "aufNumber" | "aufExpiry";
  readonly code: MemberRecordIssueCode;
};

const AUF_NUMBER_ID = "ficha-auf-numero";
const AUF_EXPIRY_ID = "ficha-auf-vencimiento";
const AUF_HINT_ID = "ficha-auf-ayuda";

function toDraft(record: MemberRecord): Draft {
  return {
    aufNumber: record.aufNumber ?? "",
    aufExpiry: record.aufExpiry ?? "",
    groupIds: new Set(record.groups.map((group) => group.id)),
  };
}

function orNull(value: string): string | null {
  return value.trim() === "" ? null : value;
}

function toSubmission(draft: Draft): MemberRecordSubmission {
  return {
    aufNumber: orNull(draft.aufNumber),
    aufExpiry: orNull(draft.aufExpiry),
    groupIds: [...draft.groupIds],
  };
}

const FIELD_OF_ISSUE: Readonly<
  Record<MemberRecordIssueCode, FieldIssue["field"]>
> = {
  auf_number_too_long: "aufNumber",
  auf_expiry_not_a_date: "aufExpiry",
  auf_expiry_before_joined: "aufExpiry",
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
  if (status.kind === "saved") {
    return (
      <p className="auth-note" role="status">
        {translate("memberRecord.saved")}
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

function TextField({
  id,
  label,
  type,
  value,
  issueText,
  hintId,
  onChange,
}: {
  id: string;
  label: string;
  type: "text" | "date";
  value: string;
  /** El aviso de este campo, o null si no tiene ninguno. */
  issueText: string | null;
  hintId?: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const issueId = `${id}-aviso`;
  const describedBy = [issueText === null ? null : issueId, hintId ?? null]
    .filter((part) => part !== null)
    .join(" ");
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete="off"
        aria-invalid={issueText !== null}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
      {issueText === null ? null : (
        <p className="auth-field-error" id={issueId}>
          {issueText}
        </p>
      )}
    </div>
  );
}

function GroupsField({
  translate,
  clubGroups,
  chosen,
  onToggle,
}: {
  translate: Translator;
  clubGroups: readonly Group[];
  chosen: ReadonlySet<string>;
  onToggle: (groupId: string, isChosen: boolean) => void;
}): React.JSX.Element {
  return (
    <fieldset className="member-record-groups">
      <legend>{translate("memberRecord.groups.legend")}</legend>
      {clubGroups.length === 0 ? (
        <p className="admin-empty">{translate("memberRecord.groups.empty")}</p>
      ) : (
        clubGroups.map((group) => {
          const inputId = `ficha-grupo-${group.id}`;
          return (
            <div className="auth-consent" key={group.id}>
              <input
                id={inputId}
                type="checkbox"
                checked={chosen.has(group.id)}
                onChange={(event) => onToggle(group.id, event.target.checked)}
              />
              <label htmlFor={inputId}>{group.name}</label>
            </div>
          );
        })
      )}
    </fieldset>
  );
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
  return (
    <header className="member-record-header">
      <h1>{record.fullName}</h1>
      <p className="app-lead">{translate("memberRecord.lead")}</p>
      <p className="member-record-joined">
        {translate("memberRecord.joinedOn", {
          date: formatCalendarDay(locale, record.joinedOn),
        })}
      </p>
      {record.isAufExpired ? (
        <span className="directory-mark directory-mark-warning">
          {translate("directory.mark.aufExpired")}
        </span>
      ) : null}
    </header>
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
    isSendingRef.current = true;
    setStatus({ kind: "sending" });
    const result = await saveMemberRecord(record.userId, toSubmission(draft));
    isSendingRef.current = false;
    if (result.kind === "failed") {
      setStatus(result);
      return;
    }
    setRecord(result.record);
    setDraft(toDraft(result.record));
    setStatus({ kind: "saved" });
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
  const isSending = status.kind === "sending";

  return (
    <>
      <RecordHeader translate={translate} locale={locale} record={record} />
      <form
        className="auth-pending member-record-form"
        onSubmit={handleSubmit}
        noValidate
      >
        <section className="auth-fields" aria-labelledby="ficha-auf">
          <h2 id="ficha-auf">{translate("memberRecord.auf.title")}</h2>
          <TextField
            id={AUF_NUMBER_ID}
            label={translate("memberRecord.auf.number")}
            type="text"
            value={draft.aufNumber}
            issueText={issueTextFor("aufNumber")}
            hintId={AUF_HINT_ID}
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
        </section>
        <GroupsField
          translate={translate}
          clubGroups={clubGroups}
          chosen={draft.groupIds}
          onToggle={toggleGroup}
        />
        <SaveOutcome translate={translate} status={status} />
        <button type="submit" className="auth-submit" disabled={isSending}>
          {translate(isSending ? "memberRecord.saving" : "memberRecord.save")}
        </button>
      </form>
    </>
  );
}
