import { Hourglass } from "@phosphor-icons/react/dist/ssr/Hourglass";
import { useId } from "react";
import {
  describeEventDuration,
  type EventSpan,
} from "@/lib/events/event-duration";
import {
  applyQuickLength,
  type EndScope,
  type EventEndCheck,
  QUICK_LENGTHS,
} from "./event-end";
import type { EventFormLayout } from "./event-form";
import {
  type FieldProps,
  fieldId,
  FieldIssue,
  InputField,
  issueAttributes,
} from "./EventFormFields";

/**
 * Cuándo es un evento (#650, punto 4 del "#1c" del handoff de E24): la fecha
 * (o "Empieza el" en una serie), la hora de inicio y la de fin, cuánto dura
 * o por qué el fin no vale, "Termina otro día" en un evento suelto y las
 * duraciones rápidas.
 *
 * Una serie que se edita no cambia de fechas, así que no enseña la fecha.
 */

const DURATION_ICON_SIZE = 16;

function DateField(
  props: FieldProps & { readonly layout: EventFormLayout },
): React.JSX.Element | null {
  const { translate, form, layout } = props;
  if (layout === "series") {
    return null;
  }
  return (
    <InputField
      {...props}
      field="startsOn"
      type="date"
      label={translate(
        form.repeat === "weekly"
          ? "calendar.form.startsOn"
          : "calendar.form.date",
      )}
    />
  );
}

/** Termina, con su aviso debajo de la fila y no debajo de la caja: es el
 * mismo sitio donde se lee cuánto dura. */
function EndTimeInput({
  translate,
  form,
  issueText,
  onChange,
}: Omit<FieldProps, "issueTextFor"> & {
  readonly issueText: string | null;
}): React.JSX.Element {
  return (
    <div className="auth-field">
      <label htmlFor={fieldId("endTime")}>
        {translate("calendar.form.endTime")}
      </label>
      <input
        id={fieldId("endTime")}
        type="time"
        value={form.endTime}
        autoComplete="off"
        {...issueAttributes("endTime", issueText)}
        onChange={(event) => onChange({ endTime: event.target.value })}
      />
    </div>
  );
}

function Duration({
  translate,
  endCheck,
}: {
  readonly translate: FieldProps["translate"];
  readonly endCheck: EventEndCheck;
}): React.JSX.Element {
  // La región existe siempre: un lector de pantalla sólo anuncia los cambios
  // de una región que ya estaba, como el fin que pone una duración rápida.
  return (
    <div className="event-form-duration-region" aria-live="polite">
      {endCheck.kind === "valid" ? (
        <DurationText translate={translate} span={endCheck.span} />
      ) : null}
    </div>
  );
}

function DurationText({
  translate,
  span,
}: {
  readonly translate: FieldProps["translate"];
  readonly span: EventSpan;
}): React.JSX.Element {
  return (
    <p className="event-form-duration">
      <Hourglass
        aria-hidden="true"
        focusable="false"
        size={DURATION_ICON_SIZE}
      />
      {translate("calendar.form.lasts", {
        duration: describeEventDuration(translate.locale, span),
      })}
    </p>
  );
}

function EndsAnotherDay(props: FieldProps): React.JSX.Element {
  const { translate, form, onChange } = props;
  return (
    <>
      <div className="event-form-switch">
        <input
          id={fieldId("endsAnotherDay")}
          type="checkbox"
          role="switch"
          checked={form.endsAnotherDay}
          onChange={(event) =>
            onChange({ endsAnotherDay: event.target.checked })
          }
        />
        <label htmlFor={fieldId("endsAnotherDay")}>
          {translate("calendar.form.endsAnotherDay")}
        </label>
      </div>
      {form.endsAnotherDay ? (
        <InputField
          {...props}
          field="endDate"
          type="date"
          label={translate("calendar.form.endDate")}
        />
      ) : null}
    </>
  );
}

function QuickLengths({
  translate,
  form,
  scope,
  onChange,
}: Omit<FieldProps, "issueTextFor"> & {
  readonly scope: EndScope;
}): React.JSX.Element {
  const labelId = useId();
  return (
    <div className="event-form-quick" role="group" aria-labelledby={labelId}>
      <span id={labelId}>{translate("calendar.form.quickLength")}</span>
      {QUICK_LENGTHS.map((length) => (
        <button
          key={length.minutes}
          type="button"
          className="event-form-chip"
          disabled={form.startTime === ""}
          onClick={() => {
            const end = applyQuickLength(form, length.minutes, scope);
            if (end !== null) {
              onChange(end);
            }
          }}
        >
          {length.label}
        </button>
      ))}
    </div>
  );
}

export function EventWhenField(
  props: FieldProps & {
    readonly layout: EventFormLayout;
    readonly scope: EndScope;
    readonly endCheck: EventEndCheck;
    /** El aviso de Termina: el del servidor, el fin al revés o que ahora es
     * obligatorio. */
    readonly endIssueText: string | null;
  },
): React.JSX.Element {
  const { translate, scope, endCheck, endIssueText } = props;
  return (
    <fieldset className="event-form-when">
      <legend>{translate("calendar.form.when")}</legend>
      <div className="event-form-when-row">
        <DateField {...props} />
        <InputField
          {...props}
          field="startTime"
          type="time"
          label={translate("calendar.form.startTime")}
        />
        <EndTimeInput {...props} issueText={endIssueText} />
      </div>
      <FieldIssue field="endTime" text={endIssueText} />
      <Duration translate={translate} endCheck={endCheck} />
      {scope === "event" ? <EndsAnotherDay {...props} /> : null}
      <QuickLengths {...props} scope={scope} />
    </fieldset>
  );
}
