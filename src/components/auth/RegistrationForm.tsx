"use client";

import { useState } from "react";
import { readStringAt } from "@/lib/api/read-string-at";
import { describeAuthIssue } from "@/lib/auth/issue-messages";
import type { ConfirmationReceiptOutcome } from "@/lib/auth/register-member";
import {
  MEMBERSHIP_TYPES,
  PASSWORD_MIN_LENGTH,
  type RegistrationField,
  type RegistrationIssue,
  type RegistrationRequest,
  validateRegistration,
} from "@/lib/auth/registration";
import { REGISTRATION_WINDOW_MINUTES } from "@/lib/auth/registration-rate-limit";
import {
  CONFIRMATION_EMAIL_API_PATH,
  REGISTER_API_PATH,
} from "@/lib/auth/routes";
import type { CountryOption } from "@/lib/geo/countries";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { EmphasizedValue } from "./EmphasizedValue";
import { labelOfField } from "./field-labels";
import { type RequestFailure, readRequestFailure } from "./request-failure";

const EMPTY_DRAFT: RegistrationRequest = {
  fullName: "",
  email: "",
  country: "",
  password: "",
  membershipType: "",
  dateOfBirth: "",
};

type SubmissionStatus =
  | { readonly kind: "editing" }
  | { readonly kind: "submitting" }
  | { readonly kind: "failed"; readonly failure: RequestFailure }
  | {
      readonly kind: "confirmation_pending";
      readonly email: string;
      readonly outcome: ConfirmationReceiptOutcome;
    };

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Sólo el aviso de envío no disponible cambia la pantalla. Cualquier otra
 * cosa en una respuesta correcta se lee como el recibo neutro, que es el texto
 * que nunca promete de más (#147). */
function readReceiptOutcome(payload: unknown): ConfirmationReceiptOutcome {
  return readStringAt(payload, ["data", "outcome"]) === "email_unavailable"
    ? "email_unavailable"
    : "confirmation_pending";
}

async function submitRegistration(
  request: RegistrationRequest,
): Promise<SubmissionStatus> {
  let response: Response;
  try {
    response = await postJson(REGISTER_API_PATH, request);
  } catch {
    // El detalle técnico no le sirve a nadie que esté mirando un formulario, y
    // puede nombrar hosts internos.
    return { kind: "failed", failure: "network" };
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return { kind: "failed", failure: readRequestFailure(payload) };
  }
  return {
    kind: "confirmation_pending",
    email: readStringAt(payload, ["data", "email"]) ?? request.email,
    outcome: readReceiptOutcome(payload),
  };
}

/** El 422 llega con datos que el formulario ya había dado por buenos, así que
 * se pide revisarlos en vez de reintentar igual. La espera del 429 es la
 * ventana entera del límite, la misma constante con la que cuenta el
 * servidor. */
function describeSubmissionFailure(
  translate: Translator,
  failure: RequestFailure,
): string {
  switch (failure) {
    case "network":
      return translate("auth.error.network");
    case "business_rule":
      return translate("auth.registration.rejected");
    case "rate_limited":
      return translate("auth.registration.rateLimited", {
        count: REGISTRATION_WINDOW_MINUTES,
      });
    default:
      return translate("auth.registration.unexpected");
  }
}

type ResendStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "sending" }
  | { readonly kind: "answered"; readonly outcome: ConfirmationReceiptOutcome }
  | { readonly kind: "failed"; readonly failure: "network" | "rejected" };

/** Un 200 con el recibo neutro sólo dice que el servidor atendió la petición,
 * no que el correo salió: la respuesta es la misma en los dos casos a
 * propósito (#147). El aviso de envío no disponible sí se distingue, porque
 * no depende de la dirección (#154). */
async function requestResend(email: string): Promise<ResendStatus> {
  let response: Response;
  try {
    response = await postJson(CONFIRMATION_EMAIL_API_PATH, { email });
  } catch {
    return { kind: "failed", failure: "network" };
  }
  if (!response.ok) {
    return { kind: "failed", failure: "rejected" };
  }
  const payload: unknown = await response.json().catch(() => null);
  return { kind: "answered", outcome: readReceiptOutcome(payload) };
}

/** El texto no puede prometer que el correo salió, porque el servidor no lo
 * dice. Por eso nombra la salida que sirve en los dos casos: pedir otro. */
function EmailSentNotice({
  translate,
  email,
}: {
  translate: Translator;
  email: string;
}): React.JSX.Element {
  return (
    <>
      <p className="auth-lead">
        <EmphasizedValue
          text={translate("auth.registration.emailSent", { email })}
          value={email}
        />
      </p>
      <p className="auth-note">
        {translate("auth.registration.emailSentNote")}
      </p>
    </>
  );
}

function EmailUnavailableNotice({
  translate,
  email,
}: {
  translate: Translator;
  email: string;
}): React.JSX.Element {
  return (
    <>
      <p className="auth-lead">
        <EmphasizedValue
          text={translate("auth.registration.emailPending", { email })}
          value={email}
        />
      </p>
      <p className="auth-error" role="alert">
        {translate("auth.registration.emailUnavailable")}
      </p>
    </>
  );
}

/** Los del reenvío son propios: la cuenta ya está creada, y decir "no pudimos
 * crear tu cuenta" haría que la persona vuelva a registrarse. */
function ResendFeedback({
  translate,
  resend,
}: {
  translate: Translator;
  resend: ResendStatus;
}): React.JSX.Element | null {
  if (resend.kind === "failed") {
    return (
      <p className="auth-error" role="alert">
        {resend.failure === "network"
          ? translate("auth.registration.resendNetwork")
          : translate("auth.registration.resendUnexpected")}
      </p>
    );
  }
  if (resend.kind !== "answered") {
    return null;
  }
  return (
    <p className="auth-note" role="status">
      {resend.outcome === "email_unavailable"
        ? translate("auth.registration.resendStillUnavailable")
        : translate("auth.registration.resendRequested")}
    </p>
  );
}

function ConfirmationPending({
  translate,
  email,
  initialOutcome,
}: {
  translate: Translator;
  email: string;
  initialOutcome: ConfirmationReceiptOutcome;
}): React.JSX.Element {
  const [outcome, setOutcome] = useState(initialOutcome);
  const [resend, setResend] = useState<ResendStatus>({ kind: "idle" });
  const isEmailUnavailable = outcome === "email_unavailable";

  async function handleResend(): Promise<void> {
    setResend({ kind: "sending" });
    const result = await requestResend(email);
    if (result.kind === "answered") {
      setOutcome(result.outcome);
    }
    setResend(result);
  }

  return (
    <section className="auth-form" aria-labelledby="registro-confirma-titulo">
      <h1 id="registro-confirma-titulo">
        {translate("auth.registration.confirmTitle")}
      </h1>
      {isEmailUnavailable ? (
        <EmailUnavailableNotice translate={translate} email={email} />
      ) : (
        <EmailSentNotice translate={translate} email={email} />
      )}
      {/* Un segundo registro con una dirección que ya tiene identidad sale
          antes de escribir la fila del socio, así que lo que acaba de escribir
          no se guarda (#179). La pantalla no puede decir cuál de los dos casos
          es sin delatar si la dirección tiene cuenta (#147), así que lo dice
          como condición: se lee igual la cumpla quien la lea o no. */}
      <p className="auth-note">
        {translate("auth.registration.previousRegistration")}
      </p>
      <button
        type="button"
        className="auth-submit"
        onClick={handleResend}
        disabled={resend.kind === "sending"}
      >
        {isEmailUnavailable
          ? translate("auth.registration.retrySend")
          : translate("auth.registration.resend")}
      </button>
      <ResendFeedback translate={translate} resend={resend} />
    </section>
  );
}

function IssueSummary({
  translate,
  issues,
  failure,
}: {
  translate: Translator;
  issues: readonly RegistrationIssue[];
  failure: RequestFailure | null;
}): React.JSX.Element | null {
  if (failure !== null) {
    return (
      <p className="auth-error" role="alert">
        {describeSubmissionFailure(translate, failure)}
      </p>
    );
  }
  if (issues.length === 0) {
    return null;
  }
  return (
    <div className="auth-error" role="alert">
      <p>{translate("auth.form.fieldIssues")}</p>
      <ul>
        {issues.map((issue) => (
          <li key={issue.field}>
            {labelOfField(translate, issue.field)}:{" "}
            {describeAuthIssue(translate, issue.code)}
          </li>
        ))}
      </ul>
    </div>
  );
}

const PASSWORD_HINT_ID = "registro-password-hint";

function errorIdOf(field: RegistrationField): string {
  return `registro-${field}-error`;
}

/** Los atributos que comparten los seis controles. Con la forma escrita, una
 * clave mal tecleada o un valor del tipo equivocado no compilan al hacer el
 * spread; con un Record suelto sí compilarían. */
type FieldProps = {
  readonly id: string;
  readonly name: RegistrationField;
  readonly value: string;
  readonly required: true;
  readonly "aria-invalid": boolean;
  readonly "aria-describedby"?: string;
};

/** Las opciones de país llegan como prop, calculadas en el servidor en el
 * idioma de la visita, y no se generan aquí. Los nombres salen de
 * `Intl.DisplayNames` y su orden de `localeCompare`, y las dos cosas dependen
 * de la versión de ICU: Node ordena "Hungría" antes que "Hong Kong" y Chromium
 * al revés. Generarlas a los dos lados rompía la hidratación, y React
 * descartaba el árbol entero del servidor: la página perdía hasta el atributo
 * de tema. */
export function RegistrationForm({
  locale,
  countries,
}: {
  locale: Locale;
  countries: readonly CountryOption[];
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [draft, setDraft] = useState<RegistrationRequest>(EMPTY_DRAFT);
  const [issues, setIssues] = useState<readonly RegistrationIssue[]>([]);
  const [status, setStatus] = useState<SubmissionStatus>({ kind: "editing" });

  function issueFor(field: RegistrationField): RegistrationIssue | undefined {
    return issues.find((issue) => issue.field === field);
  }

  function fieldProps(field: RegistrationField): FieldProps {
    const issue = issueFor(field);
    return {
      id: `registro-${field}`,
      name: field,
      value: draft[field],
      required: true,
      "aria-invalid": issue !== undefined,
      ...(issue ? { "aria-describedby": errorIdOf(field) } : {}),
    };
  }

  /** El mensaje junto al campo, que es lo que apunta su aria-describedby. El
   * resumen de arriba lo repite a propósito: es el patrón de resumen de
   * errores, y un aria-describedby que apunta a nada es un defecto de
   * accesibilidad, no un detalle. */
  function fieldError(field: RegistrationField): React.JSX.Element | null {
    const issue = issueFor(field);
    return issue === undefined ? null : (
      <p className="auth-field-error" id={errorIdOf(field)}>
        {describeAuthIssue(translate, issue.code)}
      </p>
    );
  }

  function update(field: RegistrationField, value: string): void {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const validation = validateRegistration(draft, { now: new Date() });
    if (!validation.ok) {
      setIssues(validation.issues);
      setStatus({ kind: "editing" });
      return;
    }
    setIssues([]);
    setStatus({ kind: "submitting" });
    setStatus(await submitRegistration(validation.details));
  }

  if (status.kind === "confirmation_pending") {
    return (
      <ConfirmationPending
        translate={translate}
        email={status.email}
        initialOutcome={status.outcome}
      />
    );
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <h1>{translate("auth.registration.title")}</h1>
      <p className="auth-lead">{translate("auth.registration.lead")}</p>

      <IssueSummary
        translate={translate}
        issues={issues}
        failure={status.kind === "failed" ? status.failure : null}
      />

      <div className="auth-field">
        <label htmlFor="registro-fullName">
          {labelOfField(translate, "fullName")}
        </label>
        <input
          {...fieldProps("fullName")}
          type="text"
          autoComplete="name"
          onChange={(event) => update("fullName", event.target.value)}
        />
        {fieldError("fullName")}
      </div>

      <div className="auth-field">
        <label htmlFor="registro-email">
          {labelOfField(translate, "email")}
        </label>
        <input
          {...fieldProps("email")}
          type="email"
          autoComplete="email"
          onChange={(event) => update("email", event.target.value)}
        />
        {fieldError("email")}
      </div>

      <div className="auth-field">
        <label htmlFor="registro-country">
          {labelOfField(translate, "country")}
        </label>
        <select
          {...fieldProps("country")}
          onChange={(event) => update("country", event.target.value)}
        >
          <option value="">{translate("auth.field.countryPlaceholder")}</option>
          {countries.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
        {fieldError("country")}
      </div>

      <div className="auth-field">
        <label htmlFor="registro-dateOfBirth">
          {labelOfField(translate, "dateOfBirth")}
        </label>
        <input
          {...fieldProps("dateOfBirth")}
          type="date"
          autoComplete="bday"
          onChange={(event) => update("dateOfBirth", event.target.value)}
        />
        {fieldError("dateOfBirth")}
      </div>

      <div className="auth-field">
        <label htmlFor="registro-membershipType">
          {labelOfField(translate, "membershipType")}
        </label>
        <select
          {...fieldProps("membershipType")}
          onChange={(event) => update("membershipType", event.target.value)}
        >
          <option value="">
            {translate("auth.field.membershipTypePlaceholder")}
          </option>
          {MEMBERSHIP_TYPES.map((membershipType) => (
            <option key={membershipType} value={membershipType}>
              {membershipType}
            </option>
          ))}
        </select>
        {fieldError("membershipType")}
      </div>

      <div className="auth-field">
        <label htmlFor="registro-password">
          {labelOfField(translate, "password")}
        </label>
        <input
          {...fieldProps("password")}
          type="password"
          autoComplete="new-password"
          aria-describedby={
            issueFor("password") ? errorIdOf("password") : PASSWORD_HINT_ID
          }
          onChange={(event) => update("password", event.target.value)}
        />
        {/* La pista y el error dicen lo mismo, así que se turnan: apiladas
            eran el mismo mensaje dos veces, y tres contando el resumen. */}
        {issueFor("password") ? (
          fieldError("password")
        ) : (
          <p className="auth-hint" id={PASSWORD_HINT_ID}>
            {translate("auth.field.passwordHint", { min: PASSWORD_MIN_LENGTH })}
          </p>
        )}
      </div>

      <button
        type="submit"
        className="auth-submit"
        disabled={status.kind === "submitting"}
      >
        {translate("auth.registration.submit")}
      </button>
    </form>
  );
}
