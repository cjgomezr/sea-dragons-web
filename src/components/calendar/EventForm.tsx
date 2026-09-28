"use client";

import { useEffect, useRef, useState } from "react";
import { AudienceField } from "@/components/AudienceField";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import type { Group } from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";
import {
  describeCreateFailure,
  describeEventIssue,
  readEventIssue,
} from "./event-create-client";
import {
  type EventForm as EventFormValues,
  type EventFormField,
  type EventFormIssue,
  type EventFormLayout,
  issueFromApi,
  listMissingFields,
} from "./event-form";
import { describeManageFailure } from "./event-manage-client";
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
 *
 * Es el mismo para crear y para editar (#316): quien lo abre dice qué campos
 * lleva y qué hacer al guardar. Al editar no hay repetición, y una serie
 * tampoco enseña la fecha: sus días y sus fechas no se editan.
 */

/** Lo que devuelve guardar: terminado (el diálogo se cierra) o un fallo que
 * el formulario pinta sin borrar nada. */
export type FormSubmission = { readonly kind: "finished" } | ApiRequestFailure;

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "sending" }
  | ApiRequestFailure;

function ScheduleFields(
  props: FieldProps & { readonly layout: EventFormLayout },
): React.JSX.Element {
  const { translate, form, layout } = props;
  if (layout === "series") {
    return (
      <InputField
        {...props}
        field="startTime"
        type="time"
        label={translate("calendar.form.time")}
      />
    );
  }
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
  layout,
  status,
}: {
  readonly translate: Translator;
  readonly layout: EventFormLayout;
  readonly status: Status;
}): React.JSX.Element | null {
  if (status.kind !== "failed") {
    return null;
  }
  return (
    <p className="auth-error" role="alert">
      {layout === "create"
        ? describeCreateFailure(translate, status)
        : describeManageFailure(translate, status)}
    </p>
  );
}

const SUBMIT_LABELS = {
  create: "calendar.form.submit",
  event: "calendar.edit.submit",
  series: "calendar.edit.submit",
} as const satisfies Record<EventFormLayout, string>;

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
  layout,
  initialForm,
  submit,
  onCancel,
  onSendingChange,
}: {
  readonly translate: Translator;
  readonly clubGroups: readonly Group[];
  readonly layout: EventFormLayout;
  readonly initialForm: EventFormValues;
  readonly submit: (form: EventFormValues) => Promise<FormSubmission>;
  readonly onCancel: () => void;
  /** Mientras se guarda, el diálogo no se deja cerrar. */
  readonly onSendingChange: (isSending: boolean) => void;
}): React.JSX.Element {
  const [form, setForm] = useState<EventFormValues>(initialForm);
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
    const result = await submit(form);
    markSending(false);
    if (result.kind === "finished") {
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
      {layout === "series" ? (
        <p className="event-form-warning">
          {translate("calendar.edit.seriesWarning")}
        </p>
      ) : null}
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
        {layout === "create" ? <RepeatField {...fieldProps} /> : null}
        <ScheduleFields {...fieldProps} layout={layout} />
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
      <SubmitFailure translate={translate} layout={layout} status={status} />
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
            isSending ? "calendar.form.sending" : SUBMIT_LABELS[layout],
          )}
        </button>
      </div>
    </form>
  );
}
