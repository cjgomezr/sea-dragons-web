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
  endScopeOf,
  issueFromApi,
  listMissingFields,
} from "./event-form";
import {
  describeManageFailure,
  isSeriesChangedFailure,
} from "./event-manage-client";
import { type EventEndCheck, evaluateEventEnd } from "./event-end";
import { EventCoverField, describeCoverIssue } from "./EventCoverField";
import {
  type FieldProps,
  InputField,
  NotesField,
  RepeatField,
  TypeField,
  WeekdaysField,
} from "./EventFormFields";
import { EventPlaceField } from "./EventPlaceField";
import { EventWhenField } from "./EventWhenField";
import { useEventCover } from "./use-event-cover";

/**
 * El formulario del diálogo de evento (#313, RF-9 del PRD de E7). Un fallo
 * al guardar no borra nada: lo escrito sigue ahí para corregirlo o
 * reintentar. El motivo de un 422 va junto a su campo; el resto (la red, la
 * sesión) va arriba de los botones.
 *
 * Es el mismo para crear y para editar (#316): quien lo abre dice qué campos
 * lleva y qué hacer al guardar. Al editar no hay repetición. Una serie se
 * edita desde una de sus sesiones (#655): no enseña la fecha, que es la de
 * esa sesión, pero sí sus días y "Hasta".
 */

/** Lo que devuelve guardar: terminado (el diálogo se cierra) o un fallo que
 * el formulario pinta sin borrar nada. */
export type FormSubmission = { readonly kind: "finished" } | ApiRequestFailure;

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "sending" }
  | ApiRequestFailure;

/** Los días y el final de una serie nueva, o de una que se edita desde una
 * sesión. La repetición se rehace en #651; aquí queda como estaba. */
function WeeklyFields(props: FieldProps): React.JSX.Element {
  return (
    <>
      <WeekdaysField {...props} />
      <InputField
        {...props}
        field="endsOn"
        type="date"
        label={props.translate("calendar.form.endsOn")}
      />
    </>
  );
}

/** El aviso de Termina: el del servidor manda; si no hay, el fin al revés o
 * que un evento anterior a E24 ahora la necesita. */
function describeEndIssue(
  translate: Translator,
  check: {
    readonly serverIssue: string | null;
    readonly endCheck: EventEndCheck;
    readonly isEndNowRequired: boolean;
  },
): string | null {
  if (check.serverIssue !== null) {
    return check.serverIssue;
  }
  if (check.endCheck.kind === "invalid") {
    return translate("calendar.form.issue.end_before_start");
  }
  return check.isEndNowRequired
    ? translate("calendar.form.endTimeNowRequired")
    : null;
}

/** La serie que cambió mientras se editaba (#655) no se arregla
 * reintentando: el aviso trae con qué recargarla. */
function SeriesChangedFailure({
  translate,
  status,
  onReload,
}: {
  readonly translate: Translator;
  readonly status: ApiRequestFailure;
  readonly onReload: () => void;
}): React.JSX.Element {
  return (
    <div className="event-form-stale" role="alert">
      <p className="auth-error">{describeManageFailure(translate, status)}</p>
      <button type="button" className="admin-secondary" onClick={onReload}>
        {translate("calendar.manage.reload")}
      </button>
    </div>
  );
}

function SubmitFailure({
  translate,
  layout,
  status,
  onReload,
}: {
  readonly translate: Translator;
  readonly layout: EventFormLayout;
  readonly status: Status;
  readonly onReload: () => void;
}): React.JSX.Element | null {
  if (status.kind !== "failed") {
    return null;
  }
  if (isSeriesChangedFailure(status)) {
    return (
      <SeriesChangedFailure
        translate={translate}
        status={status}
        onReload={onReload}
      />
    );
  }
  return (
    <p className="auth-error" role="alert">
      {layout === "create"
        ? describeCreateFailure(translate, status)
        : describeManageFailure(translate, status)}
    </p>
  );
}

/** Lo que decide si el fin vale. */
const WHEN_FIELDS: readonly (keyof EventFormValues)[] = [
  "startsOn",
  "startTime",
  "endTime",
  "endsAnotherDay",
  "endDate",
];

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
  currentCoverUrl,
  submit,
  onCancel,
  onReload,
  onSendingChange,
}: {
  readonly translate: Translator;
  readonly clubGroups: readonly Group[];
  readonly layout: EventFormLayout;
  readonly initialForm: EventFormValues;
  /** La imagen que ya tiene el evento que se edita. */
  readonly currentCoverUrl: string | null;
  readonly submit: (form: EventFormValues) => Promise<FormSubmission>;
  readonly onCancel: () => void;
  /** Cierra y vuelve a pedir lo que se editaba, que cambió por otro lado. */
  readonly onReload: () => void;
  /** Mientras se guarda, el diálogo no se deja cerrar. */
  readonly onSendingChange: (isSending: boolean) => void;
}): React.JSX.Element {
  const [form, setForm] = useState<EventFormValues>(initialForm);
  const [status, setStatus] = useState<Status>({ kind: "editing" });
  const [issues, setIssues] = useState<readonly EventFormIssue[]>([]);
  const titleRef = useRef<HTMLInputElement>(null);
  const cover = useEventCover(currentCoverUrl);
  // El estado desactiva el botón en el siguiente pintado, pero un doble clic
  // llega antes. La referencia cambia en el acto.
  const isSendingRef = useRef(false);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  function update(change: Partial<EventFormValues>): void {
    setForm((current) => ({ ...current, ...change }));
    // Sólo se va el aviso del campo que cambió: los demás siguen guiando. El
    // de Termina habla del cuándo entero, así que se va con cualquier parte.
    // Elegir o quitar un lugar cambia lo que se pinta en Lugar.
    const isWhenChange = WHEN_FIELDS.some((field) => field in change);
    const isPlaceChange = "place" in change;
    setIssues((current) =>
      current.filter(
        (issue) =>
          !(issue.field in change) &&
          !(isWhenChange && issue.field === "endTime") &&
          !(isPlaceChange && issue.field === "location"),
      ),
    );
  }

  function dropCoverIssues(): void {
    setIssues((current) => current.filter((issue) => issue.field !== "cover"));
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
    const result = await submit({ ...form, cover: cover.change });
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
  // Otra imagen deja atrás lo que el servidor dijo de la anterior.
  function chooseCover(file: File): void {
    dropCoverIssues();
    cover.choose(file);
  }

  function removeCover(): void {
    dropCoverIssues();
    cover.remove();
  }

  const isSending = status.kind === "sending";
  const scope = endScopeOf(layout, form);
  const endCheck = evaluateEventEnd(form, scope);
  // Lo anterior a E24 no tiene hora de fin (D5): guardarlo ahora la pide.
  const isEndNowRequired =
    layout !== "create" && initialForm.endTime === "" && form.endTime === "";
  const isSubmitBlocked =
    isSending ||
    cover.isUploading ||
    endCheck.kind === "invalid" ||
    isEndNowRequired;
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
        <EventCoverField
          translate={translate}
          eventType={form.eventType}
          field={{ ...cover, choose: chooseCover, remove: removeCover }}
          issueText={
            cover.issue === null
              ? issueTextFor("cover")
              : describeCoverIssue(translate, cover.issue)
          }
        />
        <TypeField {...fieldProps} />
        <InputField
          {...fieldProps}
          field="title"
          type="text"
          label={translate("calendar.form.titleLabel")}
          placeholder={translate("calendar.form.titlePlaceholder")}
          inputRef={titleRef}
        />
        <EventWhenField
          {...fieldProps}
          layout={layout}
          scope={scope}
          endCheck={endCheck}
          endIssueText={describeEndIssue(translate, {
            serverIssue: issueTextFor("endTime"),
            endCheck,
            isEndNowRequired,
          })}
        />
        {layout === "create" ? <RepeatField {...fieldProps} /> : null}
        {layout === "series" ||
        (layout === "create" && form.repeat === "weekly") ? (
          <WeeklyFields {...fieldProps} />
        ) : null}
        <EventPlaceField {...fieldProps} />
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
      <SubmitFailure
        translate={translate}
        layout={layout}
        status={status}
        onReload={onReload}
      />
      <div className="event-form-actions">
        <button
          type="button"
          className="admin-secondary"
          onClick={onCancel}
          disabled={isSending}
        >
          {translate("calendar.form.cancel")}
        </button>
        <button
          type="submit"
          className="auth-submit"
          disabled={isSubmitBlocked}
        >
          {translate(
            isSending ? "calendar.form.sending" : SUBMIT_LABELS[layout],
          )}
        </button>
      </div>
    </form>
  );
}
