"use client";

import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { useEffect, useRef, useState } from "react";
import { GroupChips } from "@/components/account/MyGroups";
import { SideCard } from "@/components/account/SideCard";
import type { Group } from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";
import type { MemberRecord } from "@/lib/members/member-record";
import { GroupsField } from "./record-fields";
import {
  type MemberRecordFailure,
  describeMemberRecordFailure,
  saveMemberRecord,
} from "./member-record-client";

/**
 * Grupos en la columna derecha de la ficha del Admin (#774, RF-5 del PRD de
 * E30): las fichas de sus grupos y Editar, que abre la lista de casillas de
 * siempre (`GroupsField`). Guarda como hoy, con `saveMemberRecord`, la lista
 * entera; el AUF y el contacto no van, que es no tocarlos, y la fecha de
 * nacimiento va la guardada.
 *
 * Lo que el servidor devuelve se lo pasa a la ficha: el formulario manda
 * después estos grupos, no los que había al abrirla.
 */

type Mode =
  | { readonly kind: "reading"; readonly hasSaved: boolean }
  | { readonly kind: "editing"; readonly chosen: ReadonlySet<string> }
  | { readonly kind: "sending"; readonly chosen: ReadonlySet<string> }
  | (MemberRecordFailure & { readonly chosen: ReadonlySet<string> });

const HEADING_ID = "ficha-grupos";

function chosenOf(record: MemberRecord): ReadonlySet<string> {
  return new Set(record.groups.map((group) => group.id));
}

function toggled(
  chosen: ReadonlySet<string>,
  groupId: string,
  isChosen: boolean,
): ReadonlySet<string> {
  const next = new Set(chosen);
  if (isChosen) {
    next.add(groupId);
  } else {
    next.delete(groupId);
  }
  return next;
}

function GroupsForm({
  translate,
  clubGroups,
  mode,
  onToggle,
  onCancel,
  onSave,
}: {
  translate: Translator;
  clubGroups: readonly Group[];
  mode: Exclude<Mode, { kind: "reading" }>;
  onToggle: (groupId: string, isChosen: boolean) => void;
  onCancel: () => void;
  onSave: () => void;
}): React.JSX.Element {
  const isSending = mode.kind === "sending";
  return (
    <form
      className="profile-side-card-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <fieldset className="member-record-fields" disabled={isSending}>
        <GroupsField
          translate={translate}
          clubGroups={clubGroups}
          chosen={mode.chosen}
          onToggle={onToggle}
        />
      </fieldset>
      {mode.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {describeMemberRecordFailure(translate, mode)}
        </p>
      ) : null}
      <div className="profile-side-card-actions">
        <button
          type="button"
          className="admin-secondary"
          disabled={isSending}
          onClick={onCancel}
        >
          {translate("profileAside.groups.cancel")}
        </button>
        <button type="submit" className="auth-submit" disabled={isSending}>
          {translate(
            isSending
              ? "profileAside.groups.saving"
              : "profileAside.groups.save",
          )}
        </button>
      </div>
    </form>
  );
}

export function MemberRecordGroups({
  translate,
  record,
  clubGroups,
  onSaved,
}: {
  translate: Translator;
  record: MemberRecord;
  clubGroups: readonly Group[];
  onSaved: (record: MemberRecord) => void;
}): React.JSX.Element {
  const [mode, setMode] = useState<Mode>({ kind: "reading", hasSaved: false });
  const editRef = useRef<HTMLButtonElement>(null);
  const firstCheckboxRef = useRef<HTMLDivElement>(null);
  // Un doble clic llega antes de que el botón se desactive.
  const isSendingRef = useRef(false);
  const isReading = mode.kind === "reading";
  const wasReadingRef = useRef(isReading);

  useEffect(() => {
    const wasReading = wasReadingRef.current;
    wasReadingRef.current = isReading;
    if (isReading && !wasReading) {
      editRef.current?.focus();
    }
    if (!isReading && wasReading) {
      firstCheckboxRef.current?.querySelector("input")?.focus();
    }
  }, [isReading]);

  function toggle(groupId: string, isChosen: boolean): void {
    setMode((current) =>
      current.kind === "reading" || current.kind === "sending"
        ? current
        : {
            kind: "editing",
            chosen: toggled(current.chosen, groupId, isChosen),
          },
    );
  }

  async function save(chosen: ReadonlySet<string>): Promise<void> {
    if (isSendingRef.current) {
      return;
    }
    isSendingRef.current = true;
    setMode({ kind: "sending", chosen });
    const result = await saveMemberRecord(record.userId, {
      auf: null,
      contact: null,
      dateOfBirth: record.dateOfBirth,
      groupIds: [...chosen],
    });
    isSendingRef.current = false;
    if (result.kind === "failed") {
      setMode({ ...result, chosen });
      return;
    }
    onSaved(result.record);
    setMode({ kind: "reading", hasSaved: true });
  }

  return (
    <SideCard
      headingId={HEADING_ID}
      title={translate("profileAside.groups.title")}
      action={
        isReading ? (
          <button
            ref={editRef}
            type="button"
            className="profile-side-card-link"
            aria-label={translate("profileAside.groups.editLabel")}
            onClick={() =>
              setMode({ kind: "editing", chosen: chosenOf(record) })
            }
          >
            <PencilSimple aria-hidden="true" weight="regular" />
            {translate("profileAside.groups.edit")}
          </button>
        ) : null
      }
    >
      {mode.kind === "reading" ? (
        <>
          {mode.hasSaved ? (
            <p className="profile-strip profile-strip-success" role="status">
              <CheckCircle aria-hidden="true" weight="regular" />
              {translate("profileAside.groups.saved")}
            </p>
          ) : null}
          <GroupChips translate={translate} groups={record.groups} />
        </>
      ) : (
        <div ref={firstCheckboxRef}>
          <GroupsForm
            translate={translate}
            clubGroups={clubGroups}
            mode={mode}
            onToggle={toggle}
            onCancel={() => setMode({ kind: "reading", hasSaved: false })}
            onSave={() => void save(mode.chosen)}
          />
        </div>
      )}
    </SideCard>
  );
}
