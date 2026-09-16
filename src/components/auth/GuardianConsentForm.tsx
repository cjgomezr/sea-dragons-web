"use client";

import { useState } from "react";
import { describeAuthIssue } from "@/lib/auth/issue-messages";
import { createTranslator } from "@/lib/i18n/translator";
import {
  type GuardianConsentField,
  type GuardianConsentIssue,
  validateGuardianConsent,
} from "@/lib/auth/guardian-consent";
import { GUARDIAN_CONSENT_API_PATH } from "@/lib/auth/routes";
import {
  type AccountRequestResult,
  sendAccountRequest,
} from "./account-request";

/**
 * El bloque del tutor dentro de completar registro (FR-082). El consentimiento
 * se recoge en esta misma pantalla, con el tutor delante: nombre, correo y una
 * casilla explícita. Mientras no se mande, la cuenta sigue `incomplete`.
 *
 * Valida con la misma función que el servidor, pero quien decide es el
 * servidor: la marca de tiempo la pone él.
 */

// Provisional hasta que la pantalla reciba el idioma de la visita.
const translate = createTranslator("es");

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
  | { readonly kind: "failed"; readonly message: string };

function errorIdOf(field: GuardianConsentField): string {
  return `tutor-${field}-error`;
}

function IssueSummary({
  issues,
  status,
}: {
  issues: readonly GuardianConsentIssue[];
  status: Status;
}): React.JSX.Element | null {
  if (status.kind === "failed") {
    return (
      <p className="auth-error" role="alert">
        {status.message}
      </p>
    );
  }
  if (issues.length === 0) {
    return null;
  }
  return (
    <div className="auth-error" role="alert">
      <p>Revisa estos datos antes de continuar:</p>
      <ul>
        {issues.map((issue) => (
          <li key={issue.field}>{describeAuthIssue(translate, issue.code)}</li>
        ))}
      </ul>
    </div>
  );
}

export function GuardianConsentForm({
  onSaved,
}: {
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
      <h2 id="tutor-titulo">Falta el consentimiento de tu tutor</h2>
      <p>
        Eras menor de 18 el día que te registraste. Tu cuenta no se activa hasta
        que tu madre, padre o tutor dé su consentimiento. Rellenad esto juntos.
      </p>

      <form className="auth-fields" onSubmit={handleSubmit} noValidate>
        <IssueSummary issues={issues} status={status} />

        <div className="auth-field">
          <label htmlFor="tutor-guardianName">Nombre del tutor</label>
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
          <label htmlFor="tutor-guardianEmail">Correo del tutor</label>
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
            Soy su madre, padre o tutor legal y doy mi consentimiento para que
            el club Victoria Seadragons trate los datos de esta cuenta.
          </label>
        </div>
        {fieldError("consent")}

        <button
          type="submit"
          className="auth-submit"
          disabled={status.kind === "saving"}
        >
          Registrar el consentimiento
        </button>
      </form>
    </section>
  );
}
