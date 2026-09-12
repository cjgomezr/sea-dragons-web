"use client";

import { useState } from "react";
import { SignOutButton } from "@/components/auth/SignOutButton";
import type { PendingRequirement } from "@/lib/auth/account-activation";
import {
  COMPLETION_FIELDS,
  type CompletionField,
  type CompletionValues,
  validateCompletionValues,
} from "@/lib/auth/complete-registration";
import {
  MEMBERSHIP_TYPES,
  type RegistrationIssue,
} from "@/lib/auth/registration";
import {
  ACCOUNT_API_PATH,
  CONFIRMATION_EMAIL_API_PATH,
  DASHBOARD_PATH,
} from "@/lib/auth/routes";
import type { CountryOption } from "@/lib/geo/countries";
import { useRouter } from "next/navigation";

/**
 * La pantalla de una cuenta `incomplete` (FR-083). Sigue el lenguaje de
 * `docs/mockups/auth-light.png`, como el registro y la entrada: no tiene
 * mockup propio.
 *
 * Pide SÓLO lo que falta. Los datos que la persona ya dio no se vuelven a
 * pedir ni se muestran: el servidor no los manda, y volver a escribirlos sería
 * pedirle que se registre dos veces.
 */

const NETWORK_ERROR_MESSAGE =
  "No pudimos hablar con el servidor. Revisa tu conexión y vuelve a intentarlo.";
const UNEXPECTED_ERROR_MESSAGE =
  "No pudimos guardar tus datos. Vuelve a intentarlo en un momento.";
const REQUIRED_FIELD_MESSAGE = "Este dato es obligatorio.";

const FIELD_LABELS: Record<CompletionField, string> = {
  country: "País",
  dateOfBirth: "Fecha de nacimiento",
  membershipType: "Tipo de membresía",
};

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "saving" }
  | { readonly kind: "failed"; readonly message: string };

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

/** La lista de pendientes que devuelve el servidor, estrechada a los valores
 * que esta pantalla sabe dibujar. Lo que no reconoce se descarta en vez de
 * romper la pantalla. */
function readPending(payload: unknown): readonly PendingRequirement[] {
  const data = (payload as { data?: { pending?: unknown } } | null)?.data;
  if (!Array.isArray(data?.pending)) {
    return [];
  }
  return data.pending.filter(
    (item): item is PendingRequirement =>
      typeof item === "string" && KNOWN_REQUIREMENTS.includes(item),
  );
}

const KNOWN_REQUIREMENTS: readonly string[] = [
  ...COMPLETION_FIELDS,
  "guardianConsent",
  "emailConfirmation",
];

type SaveResult =
  | { readonly kind: "completed" }
  | {
      readonly kind: "pending";
      readonly pending: readonly PendingRequirement[];
    }
  | { readonly kind: "failed"; readonly message: string };

async function saveCompletion(values: CompletionValues): Promise<SaveResult> {
  let response: Response;
  try {
    response = await fetch(ACCOUNT_API_PATH, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
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

  return readStringAt(payload, ["data", "accountStatus"]) === "active"
    ? { kind: "completed" }
    : { kind: "pending", pending: readPending(payload) };
}

type ResendStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "sending" }
  | { readonly kind: "sent" }
  | { readonly kind: "failed"; readonly message: string };

/** El pendiente que no se rellena escribiendo: hay que abrir el enlace. Se
 * ofrece reenviarlo porque el correo se pierde, y sin esa salida la cuenta se
 * queda encallada para siempre. */
function EmailConfirmationNotice({
  email,
}: {
  email: string;
}): React.JSX.Element {
  const [resend, setResend] = useState<ResendStatus>({ kind: "idle" });

  async function handleResend(): Promise<void> {
    setResend({ kind: "sending" });
    try {
      const response = await fetch(CONFIRMATION_EMAIL_API_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
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
    <section className="auth-pending">
      <h2>Confirma tu correo</h2>
      <p>
        Te mandamos un enlace a <strong>{email}</strong>. Ábrelo para terminar:
        hasta entonces tu cuenta sigue incompleta.
      </p>
      <button
        type="button"
        className="auth-secondary"
        onClick={handleResend}
        disabled={resend.kind === "sending"}
      >
        Reenviar el correo
      </button>
      {resend.kind === "sent" && (
        <p className="auth-note" role="status">
          El enlace va en camino. Revisa también la carpeta de no deseado.
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

function GuardianConsentNotice(): React.JSX.Element {
  return (
    <section className="auth-pending">
      <h2>Falta el consentimiento de tu tutor</h2>
      <p>
        Por tu fecha de nacimiento eres menor de 18, así que tu madre, padre o
        tutor tiene que dar su consentimiento antes de que tu cuenta se active.
        Escribe al club para que te digan cómo.
      </p>
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
          <li key={issue.field}>{issue.message}</li>
        ))}
      </ul>
    </div>
  );
}

function errorIdOf(field: CompletionField): string {
  return `completar-${field}-error`;
}

/** Los campos que se muestran vacíos son obligatorios: se piden porque faltan,
 * así que mandarlos en blanco no adelanta nada. */
function missingValueIssues(
  fields: readonly CompletionField[],
  draft: CompletionValues,
): readonly RegistrationIssue[] {
  return fields
    .filter((field) => (draft[field] ?? "").trim() === "")
    .map((field) => ({
      field,
      message: `${FIELD_LABELS[field]}: ${REQUIRED_FIELD_MESSAGE}`,
    }));
}

export function CompleteRegistrationForm({
  pending,
  countries,
  email,
}: {
  pending: readonly PendingRequirement[];
  /** Calculadas en el servidor, igual que en el registro: generarlas a los dos
   * lados rompía la hidratación, porque el orden depende de la versión de ICU. */
  countries: readonly CountryOption[];
  email: string;
}): React.JSX.Element {
  const router = useRouter();
  const [requirements, setRequirements] =
    useState<readonly PendingRequirement[]>(pending);
  const [draft, setDraft] = useState<CompletionValues>({});
  const [issues, setIssues] = useState<readonly RegistrationIssue[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "editing" });

  const fields = COMPLETION_FIELDS.filter((field) =>
    requirements.includes(field),
  );

  function issueFor(field: CompletionField): RegistrationIssue | undefined {
    return issues.find((issue) => issue.field === field);
  }

  function fieldError(field: CompletionField): React.JSX.Element | null {
    const issue = issueFor(field);
    return issue === undefined ? null : (
      <p className="auth-field-error" id={errorIdOf(field)}>
        {issue.message}
      </p>
    );
  }

  function update(field: CompletionField, value: string): void {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const missing = missingValueIssues(fields, draft);
    if (missing.length > 0) {
      setIssues(missing);
      setStatus({ kind: "editing" });
      return;
    }

    const validation = validateCompletionValues({
      values: draft,
      now: new Date(),
    });
    if (!validation.ok) {
      setIssues(validation.issues);
      setStatus({ kind: "editing" });
      return;
    }

    setIssues([]);
    setStatus({ kind: "saving" });
    const result = await saveCompletion(draft);
    if (result.kind === "failed") {
      setStatus(result);
      return;
    }
    if (result.kind === "pending") {
      setRequirements(result.pending);
      setDraft({});
      setStatus({ kind: "editing" });
      return;
    }

    // `replace` y no `push`: esta pantalla no tiene que quedar en el historial
    // de quien ya terminó, o el botón de atrás la devuelve a ella.
    router.replace(DASHBOARD_PATH);
    // Sin esto el servidor volvería a servir desde su caché de router lo que
    // renderizó cuando la cuenta todavía estaba incompleta.
    router.refresh();
  }

  return (
    <section className="auth-form" aria-labelledby="completar-titulo">
      <h1 id="completar-titulo">Termina tu registro</h1>
      <p className="auth-lead">
        A tu cuenta le falta esto para poder entrar. No te pedimos nada que ya
        nos hayas dado.
      </p>

      {fields.length > 0 && (
        <form className="auth-fields" onSubmit={handleSubmit} noValidate>
          <IssueSummary
            issues={issues}
            message={status.kind === "failed" ? status.message : null}
          />

          {fields.includes("country") && (
            <div className="auth-field">
              <label htmlFor="completar-country">{FIELD_LABELS.country}</label>
              <select
                id="completar-country"
                name="country"
                value={draft.country ?? ""}
                required
                aria-invalid={issueFor("country") !== undefined}
                aria-describedby={
                  issueFor("country") ? errorIdOf("country") : undefined
                }
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
          )}

          {fields.includes("dateOfBirth") && (
            <div className="auth-field">
              <label htmlFor="completar-dateOfBirth">
                {FIELD_LABELS.dateOfBirth}
              </label>
              <input
                id="completar-dateOfBirth"
                name="dateOfBirth"
                type="date"
                autoComplete="bday"
                value={draft.dateOfBirth ?? ""}
                required
                aria-invalid={issueFor("dateOfBirth") !== undefined}
                aria-describedby={
                  issueFor("dateOfBirth") ? errorIdOf("dateOfBirth") : undefined
                }
                onChange={(event) => update("dateOfBirth", event.target.value)}
              />
              {fieldError("dateOfBirth")}
            </div>
          )}

          {fields.includes("membershipType") && (
            <div className="auth-field">
              <label htmlFor="completar-membershipType">
                {FIELD_LABELS.membershipType}
              </label>
              <select
                id="completar-membershipType"
                name="membershipType"
                value={draft.membershipType ?? ""}
                required
                aria-invalid={issueFor("membershipType") !== undefined}
                aria-describedby={
                  issueFor("membershipType")
                    ? errorIdOf("membershipType")
                    : undefined
                }
                onChange={(event) =>
                  update("membershipType", event.target.value)
                }
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
          )}

          <button
            type="submit"
            className="auth-submit"
            disabled={status.kind === "saving"}
          >
            Guardar y continuar
          </button>
        </form>
      )}

      {requirements.includes("guardianConsent") && <GuardianConsentNotice />}
      {requirements.includes("emailConfirmation") && (
        <EmailConfirmationNotice email={email} />
      )}

      {/* La otra única cosa que esta cuenta puede hacer. Sin esto la pantalla
          es un callejón sin salida: no hay cáscara ni menú desde donde salir,
          y la frontera devuelve aquí todo lo demás que se pida. */}
      <SignOutButton appearance="text" />
    </section>
  );
}
