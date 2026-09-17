"use client";

import Link from "next/link";
import { useState } from "react";
import { readStringAt } from "@/lib/api/read-string-at";
import { describeAuthIssue } from "@/lib/auth/issue-messages";
import {
  PASSWORD_RECOVERY_WINDOW_MINUTES,
  RECOVERY_LINK_LIFETIME_MINUTES,
} from "@/lib/auth/password-recovery";
import { PASSWORD_RECOVERY_API_PATH, SIGN_IN_PATH } from "@/lib/auth/routes";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { EmphasizedValue } from "./EmphasizedValue";
import { type RequestFailure, readRequestFailure } from "./request-failure";

/**
 * Pedir el enlace de recuperación (RF-6). No tiene mockup propio: sigue el
 * lenguaje de `docs/mockups/auth-light.png`, al que se llega por el
 * "¿Olvidaste tu contraseña?" de la entrada.
 *
 * La confirmación dice lo mismo exista o no la cuenta. Es lo único que impide
 * usar esta pantalla para averiguar quién es socio del club.
 */

type RecoveryFailure = RequestFailure | "empty_email";

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "submitting" }
  | { readonly kind: "failed"; readonly failure: RecoveryFailure }
  | { readonly kind: "requested"; readonly email: string };

async function submitRecoveryRequest(email: string): Promise<Status> {
  let response: Response;
  try {
    response = await fetch(PASSWORD_RECOVERY_API_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch {
    return { kind: "failed", failure: "network" };
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return { kind: "failed", failure: readRequestFailure(payload) };
  }
  return {
    kind: "requested",
    email: readStringAt(payload, ["data", "email"]) ?? email,
  };
}

/** El límite de peticiones no viaja en la respuesta: la espera es la ventana
 * entera, la misma constante con la que el servidor cuenta. El 503 es que
 * ahora no se pueden mandar correos, y el 422 es un correo mal escrito, que
 * el servidor rechaza con la misma regla que el registro. */
function describeFailure(
  translate: Translator,
  failure: RecoveryFailure,
): string {
  switch (failure) {
    case "empty_email":
      return translate("auth.passwordRecovery.emptyEmail");
    case "network":
      return translate("auth.error.network");
    case "rate_limited":
      return translate("auth.passwordRecovery.rateLimited", {
        count: PASSWORD_RECOVERY_WINDOW_MINUTES,
      });
    case "service_unavailable":
      return translate("auth.passwordRecovery.emailUnavailable");
    case "business_rule":
      return describeAuthIssue(translate, "email_malformed");
    default:
      return translate("auth.passwordRecovery.unexpected");
  }
}

function RecoveryRequested({
  translate,
  email,
}: {
  translate: Translator;
  email: string;
}): React.JSX.Element {
  return (
    <section className="auth-form" aria-labelledby="recuperar-enviado-titulo">
      <h1 id="recuperar-enviado-titulo">
        {translate("auth.passwordRecovery.checkEmailTitle")}
      </h1>
      <p className="auth-lead">
        <EmphasizedValue
          text={translate("auth.passwordRecovery.linkSent", { email })}
          value={email}
        />
      </p>
      <p className="auth-note">
        {translate("auth.passwordRecovery.linkNote", {
          minutes: RECOVERY_LINK_LIFETIME_MINUTES,
        })}
      </p>
      <Link className="auth-back" href={SIGN_IN_PATH}>
        {translate("auth.passwordRecovery.backToSignIn")}
      </Link>
    </section>
  );
}

const EMAIL_FIELD_ID = "recuperar-email";

export function PasswordRecoveryRequestForm({
  locale,
}: {
  locale: Locale;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "editing" });

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (email.trim() === "") {
      setStatus({ kind: "failed", failure: "empty_email" });
      return;
    }
    setStatus({ kind: "submitting" });
    setStatus(await submitRecoveryRequest(email.trim()));
  }

  if (status.kind === "requested") {
    return <RecoveryRequested translate={translate} email={status.email} />;
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <h1>{translate("auth.passwordRecovery.title")}</h1>
      <p className="auth-lead">{translate("auth.passwordRecovery.lead")}</p>

      {status.kind === "failed" && (
        <p className="auth-error" role="alert">
          {describeFailure(translate, status.failure)}
        </p>
      )}

      <div className="auth-field">
        <label htmlFor={EMAIL_FIELD_ID}>{translate("auth.field.email")}</label>
        <input
          id={EMAIL_FIELD_ID}
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          required
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <button
        type="submit"
        className="auth-submit"
        disabled={status.kind === "submitting"}
      >
        {translate("auth.passwordRecovery.submit")}
      </button>

      <Link className="auth-back" href={SIGN_IN_PATH}>
        {translate("auth.passwordRecovery.backToSignIn")}
      </Link>
    </form>
  );
}
