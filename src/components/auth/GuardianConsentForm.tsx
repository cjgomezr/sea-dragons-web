"use client";

import { useState } from "react";
import {
  type GuardianConsentField,
  type GuardianConsentIssue,
  validateGuardianConsent,
} from "@/lib/auth/guardian-consent";
import { describeAuthIssue } from "@/lib/auth/issue-messages";
import { GUARDIAN_CONSENT_API_PATH } from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import {
  type AccountRequestResult,
  describeAccountFailure,
  sendAccountRequest,
} from "./account-request";
import type { RequestFailure } from "./request-failure";

/**
 * El bloque del tutor dentro de completar registro (FR-082). El consentimiento
 * se recoge en esta misma pantalla, con el tutor delante: nombre, correo y una
 * casilla explícita. Mientras no se mande, la cuenta sigue `incomplete`.
 *
 * Valida con la misma función que el servidor, pero quien decide es el
 * servidor: la marca de tiempo la pone él.
 */

type Draft = {
  readonly guardianName: string;
  readonly guardianEmail: string;
  readonly consent: boolean;
};

const EMPTY_DRAFT: Draft = {
  guardianName: "",
  guardianEmail: "",
  consent: false,
};

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "saving" }
  | { readonly kind: "failed"; readonly failure: RequestFailure };

function errorIdOf(field: GuardianConsentField): string {
  return `tutor-${field}-error`;
}

function IssueSummary({
  translate,
  issues,
  status,
}: {
  translate: Translator;
  issues: readonly GuardianConsentIssue[];
  status: Status;
}): React.JSX.Element | null {
  if (status.kind === "failed") {
    return (
      <p className="auth-error" role="alert">
        {describeAccountFailure(translate, status.failure)}
      </p>
    );
  }
  if (issues.length === 0) {
    return null;
  }
  return (
    <div className="auth-error" role="alert">
      <p>{translate("auth.guardian.detailIssues")}</p>
      <ul>
        {issues.map((issue) => (
          <li key={issue.field}>{describeAuthIssue(translate, issue.code)}</li>
        ))}
      </ul>
    </div>
  );
}

/** Recibe el traductor de la pantalla que lo contiene, y no el idioma: vive
 * siempre dentro de completar registro, que ya lo creó. */
export function GuardianConsentForm({
  translate,
  onSaved,
}: {
  translate: Translator;
  /** Lo que hacer cuando el servidor acepta: la pantalla decide si lleva al
   * panel o sigue pidiendo lo que falte. */
  onSaved: (result: Exclude<AccountRequestResult, { kind: "failed" }>) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [issues, setIssues] = useState<readonly GuardianConsentIssue[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "editing" });

  function describedBy(field: GuardianConsentField): string | undefined {
    return issues.some((issue) => issue.field === field)
      ? errorIdOf(field)
      : undefined;
  }

  function fieldError(field: GuardianConsentField): React.JSX.Element | null {
    const issue = issues.find((candidate) => candidate.field === field);
    return issue === undefined ? null : (
      <p className="auth-field-error" id={errorIdOf(field)}>
        {describeAuthIssue(translate, issue.code)}
      </p>
    );
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const validation = validateGuardianConsent(draft);
    if (!validation.ok) {
      setIssues(validation.issues);
      setStatus({ kind: "editing" });
      return;
    }

    setIssues([]);
    setStatus({ kind: "saving" });
    const result = await sendAccountRequest({
      path: GUARDIAN_CONSENT_API_PATH,
      method: "POST",
      body: draft,
    });
    if (result.kind === "failed") {
      setStatus(result);
      return;
    }
    setStatus({ kind: "editing" });
    onSaved(result);
  }

  return (
    <section className="auth-pending" aria-labelledby="tutor-titulo">
      <h2 id="tutor-titulo">{translate("auth.guardian.title")}</h2>
      <p>{translate("auth.guardian.body")}</p>

      <form className="auth-fields" onSubmit={handleSubmit} noValidate>
        <IssueSummary translate={translate} issues={issues} status={status} />

        <div className="auth-field">
          <label htmlFor="tutor-guardianName">
            {translate("auth.guardian.name")}
          </label>
          <input
            id="tutor-guardianName"
            name="guardianName"
            type="text"
            autoComplete="off"
            value={draft.guardianName}
            required
            aria-invalid={describedBy("guardianName") !== undefined}
            aria-describedby={describedBy("guardianName")}
            onChange={(event) =>
              setDraft({ ...draft, guardianName: event.target.value })
            }
          />
          {fieldError("guardianName")}
        </div>

        <div className="auth-field">
          <label htmlFor="tutor-guardianEmail">
            {translate("auth.guardian.email")}
          </label>
          <input
            id="tutor-guardianEmail"
            name="guardianEmail"
            type="email"
            autoComplete="off"
            value={draft.guardianEmail}
            required
            aria-invalid={describedBy("guardianEmail") !== undefined}
            aria-describedby={describedBy("guardianEmail")}
            onChange={(event) =>
              setDraft({ ...draft, guardianEmail: event.target.value })
            }
          />
          {fieldError("guardianEmail")}
        </div>

        <div className="auth-consent">
          <input
            id="tutor-consent"
            name="consent"
            type="checkbox"
            checked={draft.consent}
            required
            aria-invalid={describedBy("consent") !== undefined}
            aria-describedby={describedBy("consent")}
            onChange={(event) =>
              setDraft({ ...draft, consent: event.target.checked })
            }
          />
          <label htmlFor="tutor-consent">
            {translate("auth.guardian.consent")}
          </label>
        </div>
        {fieldError("consent")}

        <button
          type="submit"
          className="auth-submit"
          disabled={status.kind === "saving"}
        >
          {translate("auth.guardian.submit")}
        </button>
      </form>
    </section>
  );
}
