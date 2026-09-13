"use client";

import Link from "next/link";
import { useState } from "react";
import { readStringAt } from "@/lib/api/read-string-at";
import { RECOVERY_LINK_LIFETIME_MINUTES } from "@/lib/auth/password-recovery";
import { PASSWORD_RECOVERY_API_PATH, SIGN_IN_PATH } from "@/lib/auth/routes";

/**
 * Pedir el enlace de recuperación (RF-6). No tiene mockup propio: sigue el
 * lenguaje de `docs/mockups/auth-light.png`, al que se llega por el
 * "¿Olvidaste tu contraseña?" de la entrada.
 *
 * La confirmación dice lo mismo exista o no la cuenta. Es lo único que impide
 * usar esta pantalla para averiguar quién es socio del club.
 */

const NETWORK_ERROR_MESSAGE =
  "No pudimos hablar con el servidor. Revisa tu conexión y vuelve a intentarlo.";
const UNEXPECTED_ERROR_MESSAGE =
  "No pudimos pedir el enlace. Vuelve a intentarlo en un momento.";
const EMPTY_EMAIL_MESSAGE =
  "Escribe el correo de tu cuenta para pedir el enlace.";

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "submitting" }
  | { readonly kind: "failed"; readonly message: string }
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
    kind: "requested",
    email: readStringAt(payload, ["data", "email"]) ?? email,
  };
}

function RecoveryRequested({ email }: { email: string }): React.JSX.Element {
  return (
    <section className="auth-form" aria-labelledby="recuperar-enviado-titulo">
      <h1 id="recuperar-enviado-titulo">Revisa tu correo</h1>
      <p className="auth-lead">
        Si <strong>{email}</strong> tiene una cuenta en el club, te mandamos un
        enlace para elegir una contraseña nueva.
      </p>
      <p className="auth-note">
        El enlace caduca a los {RECOVERY_LINK_LIFETIME_MINUTES} minutos y sirve
        una sola vez. Si no llega, revisa la carpeta de spam o vuelve a pedirlo.
      </p>
      <Link className="auth-back" href={SIGN_IN_PATH}>
        Volver a entrar
      </Link>
    </section>
  );
}

const EMAIL_FIELD_ID = "recuperar-email";

export function PasswordRecoveryRequestForm(): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "editing" });

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (email.trim() === "") {
      setStatus({ kind: "failed", message: EMPTY_EMAIL_MESSAGE });
      return;
    }
    setStatus({ kind: "submitting" });
    setStatus(await submitRecoveryRequest(email.trim()));
  }

  if (status.kind === "requested") {
    return <RecoveryRequested email={status.email} />;
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <h1>Recuperar tu contraseña</h1>
      <p className="auth-lead">
        Escribe el correo de tu cuenta y te mandaremos un enlace para elegir una
        contraseña nueva.
      </p>

      {status.kind === "failed" && (
        <p className="auth-error" role="alert">
          {status.message}
        </p>
      )}

      <div className="auth-field">
        <label htmlFor={EMAIL_FIELD_ID}>Correo electrónico</label>
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
        Enviar enlace
      </button>

      <Link className="auth-back" href={SIGN_IN_PATH}>
        Volver a entrar
      </Link>
    </form>
  );
}
