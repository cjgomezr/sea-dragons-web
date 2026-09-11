"use client";

import { useState } from "react";
import {
  MEMBERSHIP_TYPES,
  PASSWORD_MIN_LENGTH,
  type RegistrationField,
  type RegistrationIssue,
  type RegistrationRequest,
  validateRegistration,
} from "@/lib/auth/registration";
import type { CountryOption } from "@/lib/geo/countries";

const REGISTER_ENDPOINT = "/api/v1/auth/register";
const CONFIRMATION_EMAIL_ENDPOINT = "/api/v1/auth/confirmation-email";

const NETWORK_ERROR_MESSAGE =
  "No pudimos hablar con el servidor. Revisa tu conexión y vuelve a intentarlo.";
const UNEXPECTED_ERROR_MESSAGE =
  "No pudimos crear tu cuenta. Vuelve a intentarlo en un momento.";

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

type SubmissionStatus =
  | { readonly kind: "editing" }
  | { readonly kind: "submitting" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "confirmation_pending"; readonly email: string };

/** Lee un texto en una ruta de un JSON que llega como unknown, sin confiar en
 * su forma: la respuesta viene de la red y podría ser cualquier cosa. */
function readStringAt(
  payload: unknown,
  path: readonly string[],
): string | null {
  let current: unknown = payload;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : null;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function submitRegistration(
  request: RegistrationRequest,
): Promise<SubmissionStatus> {
  let response: Response;
  try {
    response = await postJson(REGISTER_ENDPOINT, request);
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
  };
}

type ResendStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "sending" }
  | { readonly kind: "sent" }
  | { readonly kind: "failed"; readonly message: string };

function ConfirmationPending({ email }: { email: string }): React.JSX.Element {
  const [resend, setResend] = useState<ResendStatus>({ kind: "idle" });

  async function handleResend(): Promise<void> {
    setResend({ kind: "sending" });
    try {
      const response = await postJson(CONFIRMATION_EMAIL_ENDPOINT, { email });
      setResend(
        response.ok
          ? { kind: "sent" }
          : { kind: "failed", message: UNEXPECTED_ERROR_MESSAGE },
      );
    } catch {
      setResend({ kind: "failed", message: NETWORK_ERROR_MESSAGE });
    }
  }

  return (
    <section className="auth-form" aria-labelledby="registro-confirma-titulo">
      <h1 id="registro-confirma-titulo">Confirma tu correo</h1>
      <p className="auth-lead">
        Creamos tu cuenta y te mandamos un enlace a <strong>{email}</strong>.
        Ábrelo para terminar: hasta entonces tu cuenta queda incompleta y no
        puedes entrar.
      </p>
      <button
        type="button"
        className="auth-submit"
        onClick={handleResend}
        disabled={resend.kind === "sending"}
      >
        Reenviar el correo
      </button>
      {resend.kind === "sent" && (
        <p className="auth-note" role="status">
          Si esa dirección tiene una cuenta sin confirmar, el enlace va en
          camino.
        </p>
      )}
      {resend.kind === "failed" && (
        <p className="auth-error" role="alert">
          {resend.message}
        </p>
      )}
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
            {FIELD_LABELS[issue.field]}: {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function errorIdOf(field: RegistrationField): string {
  return `registro-${field}-error`;
}

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

  function fieldProps(
    field: RegistrationField,
  ): Record<string, string | boolean> {
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
        {issue.message}
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
    return <ConfirmationPending email={status.email} />;
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
            issueFor("password")
              ? `${errorIdOf("password")} registro-password-hint`
              : "registro-password-hint"
          }
          onChange={(event) => update("password", event.target.value)}
        />
        <p className="auth-hint" id="registro-password-hint">
          Al menos {PASSWORD_MIN_LENGTH} caracteres.
        </p>
        {fieldError("password")}
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
