import { EVENT_TYPES, type EventType } from "@/lib/events/event-creation";
import { ISO_WEEKDAYS, type IsoWeekday } from "@/lib/events/event-occurrences";
import { formatWeekdayName } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { EventForm, EventFormField, EventRepeat } from "./event-form";

/**
 * Los campos del diálogo de evento (#313), en el orden del prototipo
 * (`modalEvent` en docs/Seadragons Platform.dc.html). Cada uno pinta su aviso
 * debajo y lo enlaza con `aria-describedby`, así un lector de pantalla lo lee
 * al volver al campo.
 */

export type FieldProps = {
  readonly translate: Translator;
  readonly form: EventForm;
  readonly issueTextFor: (field: EventFormField) => string | null;
  readonly onChange: (change: Partial<EventForm>) => void;
};

const ID_PREFIX = "evento";

function fieldId(field: EventFormField | "eventType" | "repeat"): string {
  return `${ID_PREFIX}-${field}`;
}

function issueId(field: EventFormField): string {
  return `${fieldId(field)}-aviso`;
}

function FieldIssue({
  field,
  text,
}: {
  readonly field: EventFormField;
  readonly text: string | null;
}): React.JSX.Element | null {
  return text === null ? null : (
    <p className="auth-field-error" id={issueId(field)}>
      {text}
    </p>
  );
}

/** Lo que enlaza un campo con su aviso, si lo tiene. */
function issueAttributes(
  field: EventFormField,
  issueText: string | null,
): { "aria-invalid": boolean; "aria-describedby": string | undefined } {
  return {
    "aria-invalid": issueText !== null,
    "aria-describedby": issueText === null ? undefined : issueId(field),
  };
}

type InputFieldField = Extract<
  EventFormField,
  "title" | "startsOn" | "endsOn" | "startTime" | "location"
>;

export function InputField({
  field,
  label,
  type,
  placeholder,
  inputRef,
  form,
  issueTextFor,
  onChange,
}: Omit<FieldProps, "translate"> & {
  readonly field: InputFieldField;
  readonly label: string;
  readonly type: "text" | "date" | "time";
  readonly placeholder?: string;
  readonly inputRef?: React.Ref<HTMLInputElement>;
}): React.JSX.Element {
  const issueText = issueTextFor(field);
  return (
    <div className="auth-field">
      <label htmlFor={fieldId(field)}>{label}</label>
      <input
        ref={inputRef}
        id={fieldId(field)}
        type={type}
        value={form[field]}
        placeholder={placeholder}
        autoComplete="off"
        {...issueAttributes(field, issueText)}
        onChange={(event) => onChange({ [field]: event.target.value })}
      />
      <FieldIssue field={field} text={issueText} />
    </div>
  );
}

export function NotesField({
  translate,
  form,
  issueTextFor,
  onChange,
}: FieldProps): React.JSX.Element {
  const issueText = issueTextFor("notes");
  return (
    <div className="auth-field">
      <label htmlFor={fieldId("notes")}>
        {translate("calendar.form.notes")}
      </label>
      <textarea
        id={fieldId("notes")}
        className="event-form-notes"
        rows={3}
        value={form.notes}
        {...issueAttributes("notes", issueText)}
        onChange={(event) => onChange({ notes: event.target.value })}
      />
      <FieldIssue field="notes" text={issueText} />
    </div>
  );
}

function isEventType(value: string): value is EventType {
  return EVENT_TYPES.some((type) => type === value);
}

export function TypeField({
  translate,
  form,
  onChange,
}: FieldProps): React.JSX.Element {
  return (
    <div className="auth-field">
      <label htmlFor={fieldId("eventType")}>
        {translate("calendar.form.type")}
      </label>
      <select
        id={fieldId("eventType")}
        value={form.eventType}
        onChange={(event) => {
          if (isEventType(event.target.value)) {
            onChange({ eventType: event.target.value });
          }
        }}
      >
        {EVENT_TYPES.map((type) => (
          <option key={type} value={type}>
            {translate(`event.type.${type}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

const REPEAT_OPTIONS: readonly EventRepeat[] = ["none", "weekly"];

/** "Una vez" o "Semanal", como el control segmentado del prototipo, pero con
 * radios: es una sola elección entre dos. */
export function RepeatField({
  translate,
  form,
  onChange,
}: FieldProps): React.JSX.Element {
  return (
    <fieldset className="event-form-segmented">
      <legend>{translate("calendar.form.repeat")}</legend>
      <div className="event-form-segments">
        {REPEAT_OPTIONS.map((repeat) => {
          const id = `${fieldId("repeat")}-${repeat}`;
          return (
            <div className="event-form-segment" key={repeat}>
              <input
                id={id}
                type="radio"
                name={fieldId("repeat")}
                value={repeat}
                checked={form.repeat === repeat}
                onChange={() => onChange({ repeat })}
              />
              <label htmlFor={id}>
                {translate(`calendar.form.repeat.${repeat}`)}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function toggleWeekday(
  weekdays: ReadonlySet<IsoWeekday>,
  weekday: IsoWeekday,
  isChosen: boolean,
): ReadonlySet<IsoWeekday> {
  const next = new Set(weekdays);
  if (isChosen) {
    next.add(weekday);
  } else {
    next.delete(weekday);
  }
  return next;
}

/** Los siete días como fichas: se ve el nombre corto y se lee el entero. */
export function WeekdaysField({
  translate,
  form,
  issueTextFor,
  onChange,
}: FieldProps): React.JSX.Element {
  const issueText = issueTextFor("weekdays");
  return (
    <fieldset
      className="event-form-weekdays"
      {...issueAttributes("weekdays", issueText)}
    >
      <legend>{translate("calendar.form.weekdays")}</legend>
      <div className="event-form-days">
        {ISO_WEEKDAYS.map((weekday) => {
          const id = `${fieldId("weekdays")}-${weekday}`;
          return (
            <div className="event-form-day" key={weekday}>
              <input
                id={id}
                type="checkbox"
                checked={form.weekdays.has(weekday)}
                onChange={(event) =>
                  onChange({
                    weekdays: toggleWeekday(
                      form.weekdays,
                      weekday,
                      event.target.checked,
                    ),
                  })
                }
              />
              <label htmlFor={id}>
                <span aria-hidden="true">
                  {formatWeekdayName(translate.locale, weekday, "short")}
                </span>
                <span className="visually-hidden">
                  {formatWeekdayName(translate.locale, weekday, "long")}
                </span>
              </label>
            </div>
          );
        })}
      </div>
      <FieldIssue field="weekdays" text={issueText} />
    </fieldset>
  );
}
