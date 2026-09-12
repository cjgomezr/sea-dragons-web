"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  COMPLETE_REGISTRATION_PATH,
  DASHBOARD_PATH,
  PASSWORD_RECOVERY_PATH,
  REGISTRATION_PATH,
  SESSION_API_PATH,
} from "@/lib/auth/routes";

/**
 * La pantalla de entrada de `docs/mockups/auth-light.png`.
 *
 * Divergencia declarada en el PRD de E2, no es un defecto: el separador "or
 * continue with" y los botones de Google y Apple no se dibujan, porque esos
 * dos caminos están aplazados a Release 2.
 */

const NETWORK_ERROR_MESSAGE =
  "No pudimos hablar con el servidor. Revisa tu conexión y vuelve a intentarlo.";
const UNEXPECTED_ERROR_MESSAGE =
  "No pudimos entrar. Vuelve a intentarlo en un momento.";
/** Lo dice el formulario sin preguntar al servidor: no es una credencial
 * equivocada, es que todavía no hay ninguna que comprobar. */
const EMPTY_CREDENTIALS_MESSAGE =
  "Escribe tu correo y tu contraseña para entrar.";

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "submitting" }
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

/** Los dos únicos destinos que el servidor puede devolver. Se contrastan en
 * vez de navegar a lo que venga: el resto de esta función está escrita
 * asumiendo que la respuesta viene de la red y puede ser cualquier cosa, y
 * pasarle esa cadena al router sin mirarla rompería esa misma cautela. */
const SIGN_IN_DESTINATIONS: readonly string[] = [
  DASHBOARD_PATH,
  COMPLETE_REGISTRATION_PATH,
];

type SignInResult =
  | { readonly kind: "signed-in"; readonly destination: string }
  | { readonly kind: "failed"; readonly message: string };

async function submitCredentials(credentials: {
  readonly email: string;
  readonly password: string;
}): Promise<SignInResult> {
  let response: Response;
  try {
    response = await fetch(SESSION_API_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credentials),
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

  const destination = readStringAt(payload, ["data", "destination"]);
  return destination !== null && SIGN_IN_DESTINATIONS.includes(destination)
    ? { kind: "signed-in", destination }
    : { kind: "failed", message: UNEXPECTED_ERROR_MESSAGE };
}

const EMAIL_FIELD_ID = "entrar-email";
const PASSWORD_FIELD_ID = "entrar-password";

export function SignInForm(): React.JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "editing" });

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (email.trim() === "" || password === "") {
      setStatus({ kind: "failed", message: EMPTY_CREDENTIALS_MESSAGE });
      return;
    }

    setStatus({ kind: "submitting" });
    const result = await submitCredentials({ email: email.trim(), password });
    if (result.kind === "failed") {
      setStatus(result);
      return;
    }

    // `replace` y no `push`: la pantalla de entrada no tiene que quedar en el
    // historial de quien ya entró, o el botón de atrás la devuelve a ella.
    router.replace(result.destination);
    // Sin esto el servidor volvería a servir desde su caché de router lo que
    // renderizó cuando todavía no había sesión.
    router.refresh();
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <h1>Bienvenido de vuelta</h1>
      <p className="auth-lead">Entra a tu cuenta de los Seadragons.</p>

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

      <div className="auth-field">
        <label htmlFor={PASSWORD_FIELD_ID}>Contraseña</label>
        <input
          id={PASSWORD_FIELD_ID}
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          required
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      <Link className="auth-inline-link" href={PASSWORD_RECOVERY_PATH}>
        ¿Olvidaste tu contraseña?
      </Link>

      <button
        type="submit"
        className="auth-submit"
        disabled={status.kind === "submitting"}
      >
        Entrar
      </button>

      <p className="auth-note">
        ¿Primera vez en el club?{" "}
        <Link href={REGISTRATION_PATH}>Crear una cuenta</Link>
      </p>
    </form>
  );
}
