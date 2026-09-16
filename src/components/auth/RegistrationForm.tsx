"use client";

import { useState } from "react";
import { describeAuthIssue } from "@/lib/auth/issue-messages";
import { createTranslator } from "@/lib/i18n/translator";
import { readStringAt } from "@/lib/api/read-string-at";
import type { ConfirmationReceiptOutcome } from "@/lib/auth/register-member";
import {
  MEMBERSHIP_TYPES,
  PASSWORD_MIN_LENGTH,
  type RegistrationField,
  type RegistrationIssue,
  type RegistrationRequest,
  validateRegistration,
} from "@/lib/auth/registration";
import {
  CONFIRMATION_EMAIL_API_PATH,
  REGISTER_API_PATH,
} from "@/lib/auth/routes";
import type { CountryOption } from "@/lib/geo/countries";

const NETWORK_ERROR_MESSAGE =
  "No pudimos hablar con el servidor. Revisa tu conexión y vuelve a intentarlo.";
const UNEXPECTED_ERROR_MESSAGE =
  "No pudimos crear tu cuenta. Vuelve a intentarlo en un momento.";

// Provisional hasta que la pantalla reciba el idioma de la visita.
const translate = createTranslator("es");

const FIELD_LABELS: Record<RegistrationField, string> = {
  fullName: "Nombre completo",
  email: "Correo electrónico",
  country: "País",
  dateOfBirth: "Fecha de nacimiento",
  membershipType: "Tipo de membresía",
  password: "Contraseña",
};

const EMPTY_DRAFT: RegistrationRequest = {
  fullName: "",
  email: "",
  country: "",
  password: "",
  membershipType: "",
  dateOfBirth: "",
};

// Los del reenvío son propios: la cuenta ya está creada, y decir "no pudimos
// crear tu cuenta" haría que la persona vuelva a registrarse.
const RESEND_NETWORK_ERROR_MESSAGE =
  "No pudimos pedir otro correo porque no llegamos al servidor. Revisa tu conexión y vuelve a intentarlo.";
const RESEND_UNEXPECTED_ERROR_MESSAGE =
  "No pudimos pedir otro correo. Vuelve a intentarlo en un momento.";

type SubmissionStatus =
  | { readonly kind: "editing" }
  | { readonly kind: "submitting" }
  | { readonly kind: "failed"; readonly message: string }
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
    return { kind: "failed", message: NETWORK_ERROR_MESSAGE };
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      kind: "failed",
      message:
        readStringAt(payload, ["error", "message"]) ?? UNEXPECTED_ERROR_MESSAGE,
    };
  }
  return {
    kind: "confirmation_pending",
    email: readStringAt(payload, ["data", "email"]) ?? request.email,
    outcome: readReceiptOutcome(payload),
  };
}

type ResendStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "sending" }
  | { readonly kind: "answered"; readonly outcome: ConfirmationReceiptOutcome }
  | { readonly kind: "failed"; readonly message: string };

/** Un 200 con el recibo neutro sólo dice que el servidor atendió la petición,
 * no que el correo salió: la respuesta es la misma en los dos casos a
 * propósito (#147). El aviso de envío no disponible sí se distingue, porque
 * no depende de la dirección (#154). */
async function requestResend(email: string): Promise<ResendStatus> {
  let response: Response;
  try {
    response = await postJson(CONFIRMATION_EMAIL_API_PATH, { email });
  } catch {
    return { kind: "failed", message: RESEND_NETWORK_ERROR_MESSAGE };
  }
  if (!response.ok) {
    return { kind: "failed", message: RESEND_UNEXPECTED_ERROR_MESSAGE };
  }
  const payload: unknown = await response.json().catch(() => null);
  return { kind: "answered", outcome: readReceiptOutcome(payload) };
}

/** El texto no puede prometer que el correo salió, porque el servidor no lo
 * dice. Por eso nombra la salida que sirve en los dos casos: pedir otro. */
function EmailSentNotice({ email }: { email: string }): React.JSX.Element {
  return (
    <>
      <p className="auth-lead">
        Te mandamos un enlace a <strong>{email}</strong>. Ábrelo para terminar:
        hasta entonces tu cuenta queda incompleta y no puedes entrar.
      </p>
      <p className="auth-note">
        Si no te llega en unos minutos, reenvíalo desde aquí.
      </p>
    </>
  );
}

function EmailUnavailableNotice({
  email,
}: {
  email: string;
}): React.JSX.Element {
  return (
    <>
      <p className="auth-lead">
        Para terminar tienes que abrir el enlace que mandaremos a{" "}
        <strong>{email}</strong>. Hasta entonces tu cuenta queda incompleta y no
        puedes entrar.
      </p>
      <p className="auth-error" role="alert">
        Ahora no podemos mandar correos, así que el enlace todavía no ha salido.
        Inténtalo de nuevo más tarde.
      </p>
    </>
  );
}

/** Un segundo registro con una dirección que ya tiene identidad sale antes de
 * escribir la fila del socio, así que el nombre, el país, la fecha, el tipo de
 * membresía y la contraseña que acaba de escribir no se guardan (#179). La
 * pantalla no puede decir cuál de los dos casos es sin delatar si la dirección
 * tiene cuenta (#147), así que lo dice como condición: se lee igual la cumpla
 * quien la lea o no. */
function PreviousRegistrationNote(): React.JSX.Element {
  return (
    <p className="auth-note">
      Si esta dirección ya se había registrado antes, siguen valiendo los datos
      de aquel registro, contraseña incluida: lo que acabas de escribir no los
      cambia.
    </p>
  );
}

function ResendFeedback({
  resend,
}: {
  resend: ResendStatus;
}): React.JSX.Element | null {
  if (resend.kind === "failed") {
    return (
      <p className="auth-error" role="alert">
        {resend.message}
      </p>
    );
  }
  if (resend.kind !== "answered") {
    return null;
  }
  return (
    <p className="auth-note" role="status">
      {resend.outcome === "email_unavailable"
        ? "Lo intentamos de nuevo y todavía no podemos mandar correos."
        : "Si esa dirección tiene una cuenta sin confirmar, el enlace va en camino."}
    </p>
  );
}

function ConfirmationPending({
  email,
  initialOutcome,
}: {
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
      <h1 id="registro-confirma-titulo">Confirma tu correo</h1>
      {isEmailUnavailable ? (
        <EmailUnavailableNotice email={email} />
      ) : (
        <EmailSentNotice email={email} />
      )}
      <PreviousRegistrationNote />
      <button
        type="button"
        className="auth-submit"
        onClick={handleResend}
        disabled={resend.kind === "sending"}
      >
        {isEmailUnavailable ? "Reintentar el envío" : "Reenviar el correo"}
      </button>
      <ResendFeedback resend={resend} />
    </section>
  );
}

function IssueSummary({
  issues,
  message,
}: {
  issues: readonly RegistrationIssue[];
  message: string | null;
}): React.JSX.Element | null {
  if (message !== null) {
    return (
      <p className="auth-error" role="alert">
        {message}
      </p>
    );
  }
  if (issues.length === 0) {
    return null;
  }
  return (
    <div className="auth-error" role="alert">
      <p>Revisa estos campos antes de continuar:</p>
      <ul>
        {issues.map((issue) => (
          <li key={issue.field}>
            {FIELD_LABELS[issue.field]}:{" "}
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

/** Las opciones de país llegan como prop, calculadas en el servidor, y no se
 * generan aquí. Los nombres salen de `Intl.DisplayNames` y su orden de
 * `localeCompare`, y las dos cosas dependen de la versión de ICU: Node ordena
 * "Hungría" antes que "Hong Kong" y Chromium al revés. Generarlas a los dos
 * lados rompía la hidratación, y React descartaba el árbol entero del
 * servidor: la página perdía hasta el atributo de tema. */
export function RegistrationForm({
  countries,
}: {
  countries: readonly CountryOption[];
}): React.JSX.Element {
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
        email={status.email}
        initialOutcome={status.outcome}
      />
    );
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <h1>Crear tu cuenta</h1>
      <p className="auth-lead">
        Con estos datos el club te da de alta. Te mandaremos un enlace para
        confirmar tu correo.
      </p>

      <IssueSummary
        issues={issues}
        message={status.kind === "failed" ? status.message : null}
      />

      <div className="auth-field">
        <label htmlFor="registro-fullName">{FIELD_LABELS.fullName}</label>
        <input
          {...fieldProps("fullName")}
          type="text"
          autoComplete="name"
          onChange={(event) => update("fullName", event.target.value)}
        />
        {fieldError("fullName")}
      </div>

      <div className="auth-field">
        <label htmlFor="registro-email">{FIELD_LABELS.email}</label>
        <input
          {...fieldProps("email")}
          type="email"
          autoComplete="email"
          onChange={(event) => update("email", event.target.value)}
        />
        {fieldError("email")}
      </div>

      <div className="auth-field">
        <label htmlFor="registro-country">{FIELD_LABELS.country}</label>
        <select
          {...fieldProps("country")}
          onChange={(event) => update("country", event.target.value)}
        >
          <option value="">Selecciona tu país</option>
          {countries.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
        {fieldError("country")}
      </div>

      <div className="auth-field">
        <label htmlFor="registro-dateOfBirth">{FIELD_LABELS.dateOfBirth}</label>
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
          {FIELD_LABELS.membershipType}
        </label>
        <select
          {...fieldProps("membershipType")}
          onChange={(event) => update("membershipType", event.target.value)}
        >
          <option value="">Selecciona tu membresía</option>
          {MEMBERSHIP_TYPES.map((membershipType) => (
            <option key={membershipType} value={membershipType}>
              {membershipType}
            </option>
          ))}
        </select>
        {fieldError("membershipType")}
      </div>

      <div className="auth-field">
        <label htmlFor="registro-password">{FIELD_LABELS.password}</label>
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
            Al menos {PASSWORD_MIN_LENGTH} caracteres.
          </p>
        )}
      </div>

      <button
        type="submit"
        className="auth-submit"
        disabled={status.kind === "submitting"}
      >
        Crear cuenta
      </button>
    </form>
  );
}
