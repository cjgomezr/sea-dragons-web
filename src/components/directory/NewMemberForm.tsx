"use client";

import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr/PaperPlaneTilt";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Icon } from "@/components/Icon";
import { GROUPS_PATH, memberRecordHref } from "@/lib/auth/routes";
import type { NamedPosition } from "@/lib/club/club-positions";
import { listCountryOptions } from "@/lib/geo/countries";
import type { Group } from "@/lib/groups/groups";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import type { Locale } from "@/lib/i18n/locale";
import {
  type NewMemberField,
  type NewMemberSubmission,
  listNewMemberIssues,
} from "@/lib/members/member-invitation";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import { InvitationPreview } from "./InvitationPreview";
import {
  type CreatedMemberView,
  type MemberCreationFailure,
  createMember,
  describeNewMemberFailure,
} from "./new-member-client";
import {
  FIELD_IDS,
  type FormIssue,
  asFormIssues,
  describeFormIssue,
  isPlayerDetailField,
  issueIdOf,
  serverIssueOf,
  summaryFieldName,
} from "./new-member-issues";
import { NewMemberPlayerDetails } from "./NewMemberPlayerDetails";
import { TextField } from "./record-fields";

/**
 * El formulario del panel de invitar (#862, RF-9 del PRD de E33; antes #243):
 * quién, sus grupos y, plegados, sus datos de jugador, en una sola petición.
 *
 * Al enviar con errores, un resumen arriba los cuenta y enlaza a cada campo,
 * con la misma regla que el servidor. Lo que sólo sabe el servidor, como un
 * correo que ya es de un socio, sale igual: junto a su campo y en el resumen.
 * Un fallo que no es de un campo (la red, el límite, el permiso) sale en un
 * aviso encima de la vista previa.
 */

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "sending" }
  | MemberCreationFailure;

type Draft = Omit<NewMemberSubmission, "groupIds"> & {
  readonly groupIds: ReadonlySet<string>;
};

type TextDraftField = Exclude<keyof Draft, "groupIds">;

const EMPTY_DRAFT: Draft = {
  fullName: "",
  email: "",
  country: "",
  positionId: "",
  experienceLevel: "",
  gender: "",
  aufNumber: "",
  aufExpiry: "",
  groupIds: new Set(),
};

function toSubmission(draft: Draft): NewMemberSubmission {
  return { ...draft, groupIds: [...draft.groupIds] };
}

function firstNameOf(fullName: string): string | null {
  const [first = ""] = fullName.trim().split(/\s+/);
  return first === "" ? null : first;
}

/** Los avisos a la vista: los de antes de enviar o el campo que rechazó el
 * servidor. */
function shownIssuesOf(
  localIssues: readonly FormIssue[],
  status: Status,
): readonly FormIssue[] {
  if (localIssues.length > 0 || status.kind !== "failed") {
    return localIssues;
  }
  const issue = serverIssueOf(status);
  return issue === null ? [] : [issue];
}

/** El fallo que no es de ningún campo, para el aviso de encima de la vista
 * previa. */
function bannerFailureOf(status: Status): MemberCreationFailure | null {
  return status.kind === "failed" && serverIssueOf(status) === null
    ? status
    : null;
}

function IssueSummary({
  translate,
  issues,
  summaryRef,
  onGoTo,
}: {
  readonly translate: Translator;
  readonly issues: readonly FormIssue[];
  readonly summaryRef: React.Ref<HTMLDivElement>;
  readonly onGoTo: (field: NewMemberField) => void;
}): React.JSX.Element {
  return (
    <div className="invite-summary" role="alert" tabIndex={-1} ref={summaryRef}>
      <p className="invite-summary-title">
        <Icon glyph={WarningCircle} weight="fill" />
        {translate("newMember.summary.title", { count: issues.length })}
      </p>
      <ul>
        {issues.map((issue) => (
          <li key={`${issue.field}-${issue.kind}`}>
            <a
              href={`#${FIELD_IDS[issue.field]}`}
              onClick={(event) => {
                event.preventDefault();
                onGoTo(issue.field);
              }}
            >
              {translate("newMember.summary.item", {
                field: summaryFieldName(translate, issue.field),
                issue: describeFormIssue(translate, issue),
              })}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** El correo, con el teclado de correo del móvil. Si ya es de un socio del
 * club, el aviso enlaza a su ficha (D14 del PRD de E33). */
function EmailField({
  translate,
  value,
  issue,
  onChange,
}: {
  readonly translate: Translator;
  readonly value: string;
  readonly issue: FormIssue | null;
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  const existingMember =
    issue?.kind === "emailTaken" ? issue.existingMember : null;
  return (
    <div className="auth-field">
      <label htmlFor={FIELD_IDS.email}>{translate("newMember.email")}</label>
      <input
        id={FIELD_IDS.email}
        type="email"
        inputMode="email"
        autoComplete="off"
        value={value}
        aria-invalid={issue !== null}
        aria-describedby={issue === null ? undefined : issueIdOf("email")}
        onChange={(event) => onChange(event.target.value)}
      />
      {issue === null ? null : (
        <p className="auth-field-error" id={issueIdOf("email")}>
          {describeFormIssue(translate, issue)}
          {existingMember === null ? null : (
            <>
              {" "}
              <Link href={memberRecordHref(existingMember.userId)}>
                {translate("newMember.error.openExisting", {
                  name: existingMember.fullName,
                })}
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function GroupChips({
  translate,
  clubGroups,
  chosen,
  onToggle,
}: {
  readonly translate: Translator;
  readonly clubGroups: readonly Group[];
  readonly chosen: ReadonlySet<string>;
  readonly onToggle: (groupId: string) => void;
}): React.JSX.Element {
  const labelId = useId();
  return (
    <div className="invite-section" role="group" aria-labelledby={labelId}>
      <div className="invite-section-head">
        <span className="invite-section-label" id={labelId}>
          {translate("newMember.groups.title")}
          {" · "}
          {chosen.size === 0
            ? translate("newMember.groups.none")
            : translate("newMember.groups.chosen", { count: chosen.size })}
        </span>
        <span className="invite-optional">
          {translate("newMember.groups.optional")}
        </span>
      </div>
      {clubGroups.length === 0 ? (
        <p className="invite-groups-empty">
          {translate("newMember.groups.empty")}{" "}
          <Link href={GROUPS_PATH}>{translate("newMember.groups.create")}</Link>
        </p>
      ) : (
        <div className="invite-chips">
          {clubGroups.map((group) => {
            const isChosen = chosen.has(group.id);
            return (
              <button
                key={group.id}
                type="button"
                className="invite-chip"
                aria-pressed={isChosen}
                onClick={() => onToggle(group.id)}
              >
                <Icon glyph={isChosen ? Check : Plus} />
                {group.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SubmitLabel({
  translate,
  isSending,
}: {
  readonly translate: Translator;
  readonly isSending: boolean;
}): React.JSX.Element {
  return isSending ? (
    <>
      <span className="invite-spinner" aria-hidden="true" />
      {translate("newMember.sending")}
    </>
  ) : (
    <>
      <Icon glyph={PaperPlaneTilt} />
      {translate("newMember.submit")}
    </>
  );
}

type NewMemberFormState = {
  readonly draft: Draft;
  readonly status: Status;
  readonly issues: readonly FormIssue[];
  readonly isDetailsOpen: boolean;
  readonly summaryRef: React.RefObject<HTMLDivElement | null>;
  readonly update: (change: Partial<Draft>) => void;
  readonly toggleGroup: (groupId: string) => void;
  readonly toggleDetails: () => void;
  readonly goTo: (field: NewMemberField) => void;
  readonly submit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
};

/** El estado del formulario y lo que se hace con él: editar, enviar y
 * llevar a quien lo rellena al campo de cada error. */
function useNewMemberForm({
  positions,
  onCreated,
}: {
  readonly positions: readonly NamedPosition[];
  readonly onCreated: (created: CreatedMemberView) => void;
}): NewMemberFormState {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [status, setStatus] = useState<Status>({ kind: "editing" });
  const [localIssues, setLocalIssues] = useState<readonly FormIssue[]>([]);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  // Cada envío rechazado vuelve a llevar el foco al resumen, aunque los
  // errores sean los mismos de antes.
  const [rejectedCount, setRejectedCount] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);
  // El estado desactiva el botón en el siguiente pintado, pero un doble clic
  // llega antes. La referencia cambia en el acto.
  const isSendingRef = useRef(false);

  useEffect(() => {
    if (rejectedCount > 0) {
      summaryRef.current?.focus();
    }
  }, [rejectedCount]);

  function update(change: Partial<Draft>): void {
    setDraft((current) => ({ ...current, ...change }));
    setLocalIssues([]);
    // Un aviso habla del envío anterior. Mientras se envía no se toca, o el
    // botón volvería a activarse.
    setStatus((current) =>
      current.kind === "sending" ? current : { kind: "editing" },
    );
  }

  function toggleGroup(groupId: string): void {
    const groupIds = new Set(draft.groupIds);
    if (!groupIds.delete(groupId)) {
      groupIds.add(groupId);
    }
    update({ groupIds });
  }

  /** Un campo de los datos de jugador está plegado: se abren antes de
   * enfocarlo, y en el acto, para que el campo ya se vea. */
  function goTo(field: NewMemberField): void {
    if (isPlayerDetailField(field)) {
      flushSync(() => setIsDetailsOpen(true));
    }
    document.getElementById(FIELD_IDS[field])?.focus();
  }

  async function submit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (isSendingRef.current) {
      return;
    }
    const submission = toSubmission(draft);
    const issues = listNewMemberIssues(submission, {
      todayInClub: clubCalendarDate(new Date()),
      positionChoices: positions,
    });
    if (issues.length > 0) {
      setLocalIssues(asFormIssues(issues));
      setRejectedCount((count) => count + 1);
      return;
    }
    isSendingRef.current = true;
    setStatus({ kind: "sending" });
    const result = await createMember(submission);
    isSendingRef.current = false;
    if (result.kind === "created") {
      onCreated(result.created);
      return;
    }
    setStatus(result);
    if (serverIssueOf(result) !== null) {
      setRejectedCount((count) => count + 1);
    }
  }

  return {
    draft,
    status,
    issues: shownIssuesOf(localIssues, status),
    isDetailsOpen,
    summaryRef,
    update,
    toggleGroup,
    toggleDetails: () => setIsDetailsOpen((current) => !current),
    goTo,
    submit,
  };
}

export function NewMemberForm({
  locale,
  clubName,
  clubGroups,
  positions,
  onCreated,
  onCancel,
}: {
  readonly locale: Locale;
  readonly clubName: string;
  readonly clubGroups: readonly Group[];
  /** Las activas del club, en su orden (#299). */
  readonly positions: readonly NamedPosition[];
  readonly onCreated: (created: CreatedMemberView) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const countries = useMemo(() => listCountryOptions(locale), [locale]);
  const form = useNewMemberForm({ positions, onCreated });
  const { draft, status, issues } = form;
  const issueFor = (field: NewMemberField): FormIssue | null =>
    issues.find((issue) => issue.field === field) ?? null;
  const issueTextFor = (field: NewMemberField): string | null => {
    const issue = issueFor(field);
    return issue === null ? null : describeFormIssue(translate, issue);
  };
  const onChange = (field: TextDraftField, value: string): void =>
    form.update({ [field]: value });
  const isSending = status.kind === "sending";
  const bannerFailure = bannerFailureOf(status);
  const firstName = firstNameOf(draft.fullName);
  const whoLabelId = useId();

  return (
    <form className="invite-form" onSubmit={form.submit} noValidate>
      <div className="invite-body">
        {issues.length === 0 ? null : (
          <IssueSummary
            translate={translate}
            issues={issues}
            summaryRef={form.summaryRef}
            onGoTo={form.goTo}
          />
        )}
        <fieldset className="invite-fields" disabled={isSending}>
          <div
            className="invite-section"
            role="group"
            aria-labelledby={whoLabelId}
          >
            <span className="invite-section-label" id={whoLabelId}>
              {translate("newMember.who")}
            </span>
            <div className="invite-pair">
              <TextField
                id={FIELD_IDS.fullName}
                label={translate("newMember.fullName")}
                type="text"
                value={draft.fullName}
                issueText={issueTextFor("fullName")}
                onChange={(value) => onChange("fullName", value)}
              />
              <EmailField
                translate={translate}
                value={draft.email}
                issue={issueFor("email")}
                onChange={(value) => onChange("email", value)}
              />
            </div>
          </div>
          <GroupChips
            translate={translate}
            clubGroups={clubGroups}
            chosen={draft.groupIds}
            onToggle={form.toggleGroup}
          />
          <NewMemberPlayerDetails
            translate={translate}
            draft={draft}
            issueTextFor={issueTextFor}
            onChange={onChange}
            firstName={firstName}
            isOpen={form.isDetailsOpen}
            onToggle={form.toggleDetails}
            countries={countries}
            positions={positions}
          />
          {bannerFailure === null ? null : (
            <p className="auth-error invite-banner" role="alert">
              {describeNewMemberFailure(translate, bannerFailure)}
            </p>
          )}
          <InvitationPreview
            translate={translate}
            clubName={clubName}
            firstName={firstName}
            email={draft.email}
          />
        </fieldset>
      </div>
      <div className="invite-footer">
        <p>{translate("newMember.footer")}</p>
        <div className="invite-footer-actions">
          <button
            type="button"
            className="invite-cancel"
            disabled={isSending}
            onClick={onCancel}
          >
            {translate("newMember.cancel")}
          </button>
          <button
            type="submit"
            className="auth-submit invite-submit"
            disabled={isSending}
          >
            <SubmitLabel translate={translate} isSending={isSending} />
          </button>
        </div>
      </div>
    </form>
  );
}
