"use client";

import Link from "next/link";
import { useState } from "react";
import { readStringAt } from "@/lib/api/read-string-at";
import { describeAuthIssue } from "@/lib/auth/issue-messages";
import { RECOVERY_LINK_LIFETIME_MINUTES } from "@/lib/auth/password-recovery";
import {
  type FieldIssueCode,
  PASSWORD_MIN_LENGTH,
  validatePasswordField,
} from "@/lib/auth/registration";
import {
  PASSWORD_RECOVERY_PATH,
  PASSWORD_RESET_API_PATH,
  SIGN_IN_PATH,
} from "@/lib/auth/routes";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { type RequestFailure, readRequestFailure } from "./request-failure";

/**
 * Elegir la contraseña nueva desde el enlace del correo (RF-6), con el
 * lenguaje de `docs/mockups/auth-light.png`.
 *
 * El enlace no se gasta al abrir esta pantalla sino al enviar el formulario:
 * los filtros de correo abren los enlaces para inspeccionarlos, y gastarlo al
 * abrir lo dejaría inservible antes de que su dueño llegara.
 */

/** Por qué el enlace ya no sirve. Caducado y ya usado se explican igual; una
 * contraseña que el servicio no aceptó gastó el enlace al intentarlo, y quien
 * la escribió tiene que saber que la próxima vez elija otra. */
export type LinkUnusableReason = "expired_or_used" | "password_rejected";

/** El motivo con el que la API distingue, dentro del mismo 410, la contraseña
 * rechazada del enlace caducado o ya usado. */
const PASSWORD_REJECTED_REASON = "password_rejected";

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "submitting" }
  | { readonly kind: "invalid_password"; readonly code: FieldIssueCode }
  | { readonly kind: "failed"; readonly failure: RequestFailure }
  | { readonly kind: "password_changed" }
  | { readonly kind: "link_unusable"; readonly reason: LinkUnusableReason };

async function submitNewPassword(body: {
  readonly tokenHash: string;
  readonly password: string;
}): Promise<Status> {
  let response: Response;
  try {
    response = await fetch(PASSWORD_RESET_API_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: "failed", failure: "network" };
  }

  if (response.ok) {
    return { kind: "password_changed" };
  }
  const payload: unknown = await response.json().catch(() => null);
  const failure = readRequestFailure(payload);
  if (failure !== "gone") {
    return { kind: "failed", failure };
  }
  return {
    kind: "link_unusable",
    reason:
      readStringAt(payload, ["error", "reason"]) === PASSWORD_REJECTED_REASON
        ? "password_rejected"
        : "expired_or_used",
  };
}

/** Una contraseña corta o larga no llega aquí: la frena antes la misma regla
 * que aplica el servidor. Lo que queda no se arregla desde el formulario. */
function describeFailure(
  translate: Translator,
  failure: RequestFailure,
): string {
  return failure === "network"
    ? translate("auth.error.network")
    : translate("auth.newPassword.unexpected");
}

/** También la usa la página cuando el enlace llega sin token: para quien lo
 * abre es el mismo caso, un enlace que no sirve. */
export function RecoveryLinkUnusable({
  locale,
  reason = "expired_or_used",
}: {
  locale: Locale;
  reason?: LinkUnusableReason;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  return (
    <section className="auth-form" aria-labelledby="nueva-caducada-titulo">
      <h1 id="nueva-caducada-titulo">
        {translate("auth.newPassword.linkUnusableTitle")}
      </h1>
      <p className="auth-lead">
        {reason === "password_rejected"
          ? translate("auth.newPassword.passwordRejected")
          : translate("auth.newPassword.linkUnusableBody", {
              minutes: RECOVERY_LINK_LIFETIME_MINUTES,
            })}
      </p>
      <Link
        className="auth-submit auth-submit-link"
        href={PASSWORD_RECOVERY_PATH}
      >
        {translate("auth.newPassword.requestAnotherLink")}
      </Link>
    </section>
  );
}

function PasswordChanged({
  translate,
}: {
  translate: Translator;
}): React.JSX.Element {
  return (
    <section className="auth-form" aria-labelledby="nueva-cambiada-titulo">
      <h1 id="nueva-cambiada-titulo">
        {translate("auth.newPassword.changedTitle")}
      </h1>
      <p className="auth-lead">{translate("auth.newPassword.changedLead")}</p>
      <Link className="auth-submit auth-submit-link" href={SIGN_IN_PATH}>
        {translate("auth.signIn.submit")}
      </Link>
    </section>
  );
}

const PASSWORD_FIELD_ID = "nueva-password";
const PASSWORD_HINT_ID = "nueva-password-hint";
const PASSWORD_ERROR_ID = "nueva-password-error";

export function NewPasswordForm({
  locale,
  tokenHash,
}: {
  locale: Locale;
  tokenHash: string;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "editing" });

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    // La misma regla que el servidor, antes de preguntarle: una contraseña
    // corta no llega a gastar el enlace, pero tampoco hace falta un viaje
    // para decirlo.
    const validation = validatePasswordField(password);
    if (!validation.ok) {
      setStatus({ kind: "invalid_password", code: validation.code });
      return;
    }
    setStatus({ kind: "submitting" });
    setStatus(
      await submitNewPassword({ tokenHash, password: validation.value }),
    );
  }

  if (status.kind === "password_changed") {
    return <PasswordChanged translate={translate} />;
  }
  if (status.kind === "link_unusable") {
    return <RecoveryLinkUnusable locale={locale} reason={status.reason} />;
  }

  const passwordIssue =
    status.kind === "invalid_password"
      ? describeAuthIssue(translate, status.code)
      : null;
  const alert =
    status.kind === "failed"
      ? describeFailure(translate, status.failure)
      : passwordIssue;
  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <h1>{translate("auth.newPassword.title")}</h1>
      <p className="auth-lead">{translate("auth.newPassword.lead")}</p>

      {alert !== null && (
        <p className="auth-error" role="alert">
          {alert}
        </p>
      )}

      <div className="auth-field">
        <label htmlFor={PASSWORD_FIELD_ID}>
          {translate("auth.newPassword.label")}
        </label>
        <input
          id={PASSWORD_FIELD_ID}
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          required
          aria-invalid={passwordIssue !== null}
          aria-describedby={
            passwordIssue === null ? PASSWORD_HINT_ID : PASSWORD_ERROR_ID
          }
          onChange={(event) => setPassword(event.target.value)}
        />
        {/* La pista y el error dicen lo mismo, así que se turnan, como en el
            registro. */}
        {passwordIssue === null ? (
          <p className="auth-hint" id={PASSWORD_HINT_ID}>
            {translate("auth.field.passwordHint", { min: PASSWORD_MIN_LENGTH })}
          </p>
        ) : (
          <p className="auth-field-error" id={PASSWORD_ERROR_ID}>
            {passwordIssue}
          </p>
        )}
      </div>

      <button
        type="submit"
        className="auth-submit"
        disabled={status.kind === "submitting"}
      >
        {translate("auth.newPassword.submit")}
      </button>
    </form>
  );
}
