"use client";

import Link from "next/link";
import { useState } from "react";
import { readStringAt } from "@/lib/api/read-string-at";
import { RECOVERY_LINK_LIFETIME_MINUTES } from "@/lib/auth/password-recovery";
import {
  PASSWORD_MIN_LENGTH,
  validatePasswordField,
} from "@/lib/auth/registration";
import {
  PASSWORD_RECOVERY_PATH,
  PASSWORD_RESET_API_PATH,
  SIGN_IN_PATH,
} from "@/lib/auth/routes";

/**
 * Elegir la contraseña nueva desde el enlace del correo (RF-6), con el
 * lenguaje de `docs/mockups/auth-light.png`.
 *
 * El enlace no se gasta al abrir esta pantalla sino al enviar el formulario:
 * los filtros de correo abren los enlaces para inspeccionarlos, y gastarlo al
 * abrir lo dejaría inservible antes de que su dueño llegara.
 */

const NETWORK_ERROR_MESSAGE =
  "No pudimos hablar con el servidor. Revisa tu conexión y vuelve a intentarlo.";
const UNEXPECTED_ERROR_MESSAGE =
  "No pudimos cambiar tu contraseña. Vuelve a intentarlo en un momento.";

/** El código con el que la API dice que el enlace ya no sirve: caducó, ya se
 * usó, o se gastó en un intento cuya contraseña el servicio no aceptó. */
const LINK_UNUSABLE_ERROR_CODE = "gone";

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "submitting" }
  | { readonly kind: "invalid_password"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "password_changed" }
  | { readonly kind: "link_unusable"; readonly message: string | null };

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
    return { kind: "failed", message: NETWORK_ERROR_MESSAGE };
  }

  if (response.ok) {
    return { kind: "password_changed" };
  }
  const payload: unknown = await response.json().catch(() => null);
  const message = readStringAt(payload, ["error", "message"]);
  if (readStringAt(payload, ["error", "code"]) === LINK_UNUSABLE_ERROR_CODE) {
    return { kind: "link_unusable", message };
  }
  return { kind: "failed", message: message ?? UNEXPECTED_ERROR_MESSAGE };
}

/** También la usa la página cuando el enlace llega sin token: para quien lo
 * abre es el mismo caso, un enlace que no sirve. `reason` es el motivo que dio
 * el servidor, cuando lo hay; sin él se explica el caso general. */
export function RecoveryLinkUnusable({
  reason = null,
}: {
  reason?: string | null;
}): React.JSX.Element {
  return (
    <section className="auth-form" aria-labelledby="nueva-caducada-titulo">
      <h1 id="nueva-caducada-titulo">Este enlace ya no sirve</h1>
      <p className="auth-lead">
        {reason ??
          `El enlace para cambiar tu contraseña caducó o ya se usó. Cada enlace dura ${RECOVERY_LINK_LIFETIME_MINUTES} minutos y sirve una sola vez.`}
      </p>
      <Link
        className="auth-submit auth-submit-link"
        href={PASSWORD_RECOVERY_PATH}
      >
        Pedir otro enlace
      </Link>
    </section>
  );
}

function PasswordChanged(): React.JSX.Element {
  return (
    <section className="auth-form" aria-labelledby="nueva-cambiada-titulo">
      <h1 id="nueva-cambiada-titulo">Tu contraseña quedó cambiada</h1>
      <p className="auth-lead">Ya puedes entrar con tu contraseña nueva.</p>
      <Link className="auth-submit auth-submit-link" href={SIGN_IN_PATH}>
        Entrar
      </Link>
    </section>
  );
}

const PASSWORD_FIELD_ID = "nueva-password";
const PASSWORD_HINT_ID = "nueva-password-hint";
const PASSWORD_ERROR_ID = "nueva-password-error";

export function NewPasswordForm({
  tokenHash,
}: {
  tokenHash: string;
}): React.JSX.Element {
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
      setStatus({ kind: "invalid_password", message: validation.message });
      return;
    }
    setStatus({ kind: "submitting" });
    setStatus(
      await submitNewPassword({ tokenHash, password: validation.value }),
    );
  }

  if (status.kind === "password_changed") {
    return <PasswordChanged />;
  }
  if (status.kind === "link_unusable") {
    return <RecoveryLinkUnusable reason={status.message} />;
  }

  const isInvalid = status.kind === "invalid_password";
  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <h1>Elige tu contraseña nueva</h1>
      <p className="auth-lead">
        Es la que usarás a partir de ahora para entrar al club.
      </p>

      {(status.kind === "failed" || isInvalid) && (
        <p className="auth-error" role="alert">
          {status.message}
        </p>
      )}

      <div className="auth-field">
        <label htmlFor={PASSWORD_FIELD_ID}>Contraseña nueva</label>
        <input
          id={PASSWORD_FIELD_ID}
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          required
          aria-invalid={isInvalid}
          aria-describedby={isInvalid ? PASSWORD_ERROR_ID : PASSWORD_HINT_ID}
          onChange={(event) => setPassword(event.target.value)}
        />
        {/* La pista y el error dicen lo mismo, así que se turnan, como en el
            registro. */}
        {isInvalid ? (
          <p className="auth-field-error" id={PASSWORD_ERROR_ID}>
            {status.message}
          </p>
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
        Guardar contraseña
      </button>
    </form>
  );
}
