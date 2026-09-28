"use client";

import { useEffect, useRef, useState } from "react";
import { AudienceField } from "@/components/AudienceField";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import type { Group } from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";
import {
  type CreatedSummary,
  createEvent,
  describeCreateFailure,
  describeEventIssue,
  readEventIssue,
} from "./event-create-client";
import {
  EMPTY_EVENT_FORM,
  type EventForm as EventFormValues,
  type EventFormField,
  type EventFormIssue,
  issueFromApi,
  listMissingFields,
  toEventDraft,
} from "./event-form";
import {
  type FieldProps,
  InputField,
  NotesField,
  RepeatField,
  TypeField,
  WeekdaysField,
} from "./EventFormFields";

/**
 * El formulario del diálogo de evento (#313, RF-9 del PRD de E7). Un fallo
 * al guardar no borra nada: lo escrito sigue ahí para corregirlo o
 * reintentar. El motivo de un 422 va junto a su campo; el resto (la red, la
 * sesión) va arriba de los botones.
 */

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "sending" }
  | ApiRequestFailure;

function ScheduleFields(props: FieldProps): React.JSX.Element {
  const { translate, form } = props;
  if (form.repeat === "none") {
    return (
      <div className="event-form-row">
        <InputField
          {...props}
          field="startsOn"
          type="date"
          label={translate("calendar.form.date")}
        />
        <InputField
          {...props}
          field="startTime"
          type="time"
          label={translate("calendar.form.time")}
        />
      </div>
    );
  }
  return (
    <>
      <WeekdaysField {...props} />
      <div className="event-form-row">
        <InputField
          {...props}
          field="startsOn"
          type="date"
          label={translate("calendar.form.startsOn")}
        />
        <InputField
          {...props}
          field="endsOn"
          type="date"
          label={translate("calendar.form.endsOn")}
        />
      </div>
      <InputField
        {...props}
        field="startTime"
        type="time"
        label={translate("calendar.form.time")}
      />
    </>
  );
}

function SubmitFailure({
  translate,
  status,
}: {
  readonly translate: Translator;
  readonly status: Status;
}): React.JSX.Element | null {
  if (status.kind !== "failed") {
    return null;
  }
  return (
    <p className="auth-error" role="alert">
      {describeCreateFailure(translate, status)}
    </p>
  );
}

/** El motivo de la API junto a su campo, o el fallo entero si no tiene
 * campo. */
function readFailure(failure: ApiRequestFailure): {
  readonly status: Status;
  readonly issues: readonly EventFormIssue[];
} {
  const code = readEventIssue(failure);
  return code === null
    ? { status: failure, issues: [] }
    : { status: { kind: "editing" }, issues: [issueFromApi(code)] };
}

export function EventForm({
  translate,
  clubGroups,
  onCreated,
  onCancel,
  onSendingChange,
}: {
  readonly translate: Translator;
  readonly clubGroups: readonly Group[];
  readonly onCreated: (summary: CreatedSummary) => void;
  readonly onCancel: () => void;
  /** Mientras se guarda, el diálogo no se deja cerrar. */
  readonly onSendingChange: (isSending: boolean) => void;
}): React.JSX.Element {
  const [form, setForm] = useState<EventFormValues>(EMPTY_EVENT_FORM);
  const [status, setStatus] = useState<Status>({ kind: "editing" });
  const [issues, setIssues] = useState<readonly EventFormIssue[]>([]);
  const titleRef = useRef<HTMLInputElement>(null);
  // El estado desactiva el botón en el siguiente pintado, pero un doble clic
  // llega antes. La referencia cambia en el acto.
  const isSendingRef = useRef(false);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  function update(change: Partial<EventFormValues>): void {
    setForm((current) => ({ ...current, ...change }));
    // Sólo se va el aviso del campo que cambió: los demás siguen guiando.
    setIssues((current) => current.filter((issue) => !(issue.field in change)));
  }

  function markSending(isSending: boolean): void {
    isSendingRef.current = isSending;
    onSendingChange(isSending);
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (isSendingRef.current) {
      return;
    }
    const missing = listMissingFields(form);
    if (missing.length > 0) {
      setIssues(missing);
      return;
    }
    markSending(true);
    setStatus({ kind: "sending" });
    const result = await createEvent(toEventDraft(form));
    markSending(false);
    if (result.kind === "created") {
      onCreated(result.summary);
      return;
    }
    const failure = readFailure(result);
    setStatus(failure.status);
    setIssues(failure.issues);
  }

  const issueTextFor = (field: EventFormField): string | null => {
    const issue = issues.find((candidate) => candidate.field === field);
    return issue === undefined ? null : describeEventIssue(translate, issue);
  };
  const isSending = status.kind === "sending";
  const fieldProps: FieldProps = {
    translate,
    form,
    issueTextFor,
    onChange: update,
  };

  return (
    <form className="event-form" onSubmit={handleSubmit} noValidate>
      <fieldset className="event-form-fields" disabled={isSending}>
        <InputField
          {...fieldProps}
          field="title"
          type="text"
          label={translate("calendar.form.titleLabel")}
          placeholder={translate("calendar.form.titlePlaceholder")}
          inputRef={titleRef}
        />
        <TypeField {...fieldProps} />
        <RepeatField {...fieldProps} />
        <ScheduleFields {...fieldProps} />
        <InputField
          {...fieldProps}
          field="location"
          type="text"
          label={translate("calendar.form.location")}
          placeholder={translate("calendar.form.locationPlaceholder")}
        />
        <NotesField {...fieldProps} />
        <AudienceField
          translate={translate}
          legend={translate("calendar.form.audience")}
          clubGroups={clubGroups}
          audience={form.audience}
          issueText={issueTextFor("audience")}
          onChange={(audience) => update({ audience })}
        />
      </fieldset>
      <SubmitFailure translate={translate} status={status} />
      <div className="event-form-actions">
        <button
          type="button"
          className="admin-secondary"
          onClick={onCancel}
          disabled={isSending}
        >
          {translate("calendar.form.cancel")}
        </button>
        <button type="submit" className="auth-submit" disabled={isSending}>
          {translate(
            isSending ? "calendar.form.sending" : "calendar.form.submit",
          )}
        </button>
      </div>
    </form>
  );
}
