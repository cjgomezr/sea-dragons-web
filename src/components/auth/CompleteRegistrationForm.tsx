"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  type AuthIssueCode,
  REQUIRED_ISSUE_CODE,
  describeAuthIssue,
} from "@/lib/auth/issue-messages";
import { MEMBERSHIP_TYPES } from "@/lib/auth/registration";
import {
  ACCOUNT_API_PATH,
  CONFIRMATION_EMAIL_API_PATH,
  DASHBOARD_PATH,
} from "@/lib/auth/routes";
import type { CountryOption } from "@/lib/geo/countries";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import {
  type AccountRequestResult,
  describeAccountFailure,
  sendAccountRequest,
} from "./account-request";
import { EmphasizedValue } from "./EmphasizedValue";
import { labelOfField } from "./field-labels";
import { GuardianConsentForm } from "./GuardianConsentForm";
import type { RequestFailure } from "./request-failure";

/**
 * La pantalla de una cuenta `incomplete` (FR-083). Sigue el lenguaje de
 * `docs/mockups/auth-light.png`, como el registro y la entrada: no tiene
 * mockup propio.
 *
 * Pide SÓLO lo que falta. Los datos que la persona ya dio no se vuelven a
 * pedir ni se muestran: el servidor no los manda, y volver a escribirlos sería
 * pedirle que se registre dos veces.
 */

/** Lo que se marca junto a un campo: lo que dijo la validación del dominio, o
 * que llegó vacío. */
type FormIssue = {
  readonly field: CompletionField;
  readonly code: AuthIssueCode;
};

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "saving" }
  | { readonly kind: "failed"; readonly failure: RequestFailure };

type ResendStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "sending" }
  | { readonly kind: "sent" }
  | { readonly kind: "failed"; readonly failure: RequestFailure };

/** El pendiente que no se rellena escribiendo: hay que abrir el enlace. Se
 * ofrece reenviarlo porque el correo se pierde, y sin esa salida la cuenta se
 * queda encallada para siempre. */
function EmailConfirmationNotice({
  translate,
  email,
}: {
  translate: Translator;
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
          : { kind: "failed", failure: "unrecognized_response" },
      );
    } catch {
      setResend({ kind: "failed", failure: "network" });
    }
  }

  return (
    <section className="auth-pending">
      <h2>{translate("auth.registration.confirmTitle")}</h2>
      <p>
        <EmphasizedValue
          text={translate("auth.completion.confirmEmailBody", { email })}
          value={email}
        />
      </p>
      <button
        type="button"
        className="auth-secondary"
        onClick={handleResend}
        disabled={resend.kind === "sending"}
      >
        {translate("auth.registration.resend")}
      </button>
      {resend.kind === "sent" && (
        <p className="auth-note" role="status">
          {translate("auth.completion.resendSent")}
        </p>
      )}
      {resend.kind === "failed" && (
        <p className="auth-error" role="alert">
          {describeAccountFailure(translate, resend.failure)}
        </p>
      )}
    </section>
  );
}

function IssueSummary({
  translate,
  issues,
  failure,
}: {
  translate: Translator;
  issues: readonly FormIssue[];
  failure: RequestFailure | null;
}): React.JSX.Element | null {
  if (failure !== null) {
    return (
      <p className="auth-error" role="alert">
        {describeAccountFailure(translate, failure)}
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

function errorIdOf(field: CompletionField): string {
  return `completar-${field}-error`;
}

/** Los campos que se muestran vacíos son obligatorios: se piden porque faltan,
 * así que mandarlos en blanco no adelanta nada. */
function missingValueIssues(
  fields: readonly CompletionField[],
  draft: CompletionValues,
): readonly FormIssue[] {
  return fields
    .filter((field) => (draft[field] ?? "").trim() === "")
    .map((field) => ({ field, code: REQUIRED_ISSUE_CODE }));
}

export function CompleteRegistrationForm({
  locale,
  pending,
  countries,
  email,
}: {
  locale: Locale;
  pending: readonly PendingRequirement[];
  /** Calculadas en el servidor en el idioma de la visita, igual que en el
   * registro: generarlas a los dos lados rompía la hidratación, porque el
   * orden depende de la versión de ICU. */
  countries: readonly CountryOption[];
  email: string;
}): React.JSX.Element {
  const router = useRouter();
  const translate = createTranslator(locale);
  const [requirements, setRequirements] =
    useState<readonly PendingRequirement[]>(pending);
  const [draft, setDraft] = useState<CompletionValues>({});
  const [issues, setIssues] = useState<readonly FormIssue[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "editing" });

  const fields = COMPLETION_FIELDS.filter((field) =>
    requirements.includes(field),
  );

  function issueFor(field: CompletionField): FormIssue | undefined {
    return issues.find((issue) => issue.field === field);
  }

  function fieldError(field: CompletionField): React.JSX.Element | null {
    const issue = issueFor(field);
    return issue === undefined ? null : (
      <p className="auth-field-error" id={errorIdOf(field)}>
        {describeAuthIssue(translate, issue.code)}
      </p>
    );
  }

  function update(field: CompletionField, value: string): void {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  /** Lo que ocurre cuando el servidor acepta algo, venga del formulario de
   * los datos o del bloque del tutor: o la cuenta quedó activa, o la pantalla
   * pasa a pedir lo que el servidor dice que sigue faltando. */
  function applySaved(
    result: Exclude<AccountRequestResult, { kind: "failed" }>,
  ): void {
    if (result.kind === "pending") {
      setRequirements(result.pending);
      return;
    }
    // `replace` y no `push`: esta pantalla no tiene que quedar en el historial
    // de quien ya terminó, o el botón de atrás la devuelve a ella.
    router.replace(DASHBOARD_PATH);
    // Sin esto el servidor volvería a servir desde su caché de router lo que
    // renderizó cuando la cuenta todavía estaba incompleta.
    router.refresh();
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
    const result = await sendAccountRequest({
      path: ACCOUNT_API_PATH,
      method: "PATCH",
      body: draft,
    });
    if (result.kind === "failed") {
      setStatus(result);
      return;
    }
    setDraft({});
    setStatus({ kind: "editing" });
    applySaved(result);
  }

  // La frontera manda aquí todo lo que pida una cuenta incompleta, así que
  // esta pantalla nunca puede quedarse sin nada que ofrecer. Sin esta rama, un
  // `pending` vacío dejaba un título, un texto que miente y ninguna salida.
  if (requirements.length === 0) {
    return (
      <section className="auth-form" aria-labelledby="completar-titulo">
        <h1 id="completar-titulo">
          {translate("auth.completion.nothingLeftTitle")}
        </h1>
        <p className="auth-lead">
          {translate("auth.completion.nothingLeftLead")}
        </p>
        <Link className="auth-submit auth-submit-link" href={DASHBOARD_PATH}>
          {translate("auth.completion.goToDashboard")}
        </Link>
        <SignOutButton locale={locale} appearance="text" />
      </section>
    );
  }

  return (
    <section className="auth-form" aria-labelledby="completar-titulo">
      <h1 id="completar-titulo">{translate("auth.completion.title")}</h1>
      <p className="auth-lead">{translate("auth.completion.lead")}</p>

      {fields.length > 0 && (
        <form className="auth-fields" onSubmit={handleSubmit} noValidate>
          <IssueSummary
            translate={translate}
            issues={issues}
            failure={status.kind === "failed" ? status.failure : null}
          />

          {fields.includes("country") && (
            <div className="auth-field">
              <label htmlFor="completar-country">
                {labelOfField(translate, "country")}
              </label>
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
                <option value="">
                  {translate("auth.field.countryPlaceholder")}
                </option>
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
                {labelOfField(translate, "dateOfBirth")}
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
                {labelOfField(translate, "membershipType")}
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
          )}

          <button
            type="submit"
            className="auth-submit"
            disabled={status.kind === "saving"}
          >
            {translate("auth.completion.submit")}
          </button>
        </form>
      )}

      {requirements.includes("guardianConsent") && (
        <GuardianConsentForm translate={translate} onSaved={applySaved} />
      )}
      {requirements.includes("emailConfirmation") && (
        <EmailConfirmationNotice translate={translate} email={email} />
      )}

      {/* La otra única cosa que esta cuenta puede hacer. Sin esto la pantalla
          es un callejón sin salida: no hay cáscara ni menú desde donde salir,
          y la frontera devuelve aquí todo lo demás que se pida. */}
      <SignOutButton locale={locale} appearance="text" />
    </section>
  );
}
