"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { readStringAt } from "@/lib/api/read-string-at";
import {
  COMPLETE_REGISTRATION_PATH,
  DASHBOARD_PATH,
  PASSWORD_RECOVERY_PATH,
  REGISTRATION_PATH,
  SESSION_API_PATH,
} from "@/lib/auth/routes";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { type RequestFailure, readRequestFailure } from "./request-failure";

/**
 * La pantalla de entrada de `docs/mockups/auth-light.png`.
 *
 * Divergencia declarada en el PRD de E2, no es un defecto: el separador "or
 * continue with" y los botones de Google y Apple no se dibujan, porque esos
 * dos caminos están aplazados a Release 2.
 */

/** Lo dice el formulario sin preguntar al servidor: no es una credencial
 * equivocada, es que todavía no hay ninguna que comprobar. */
type SignInFailure = RequestFailure | "empty_credentials";

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "submitting" }
  | { readonly kind: "failed"; readonly failure: SignInFailure };

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
  | { readonly kind: "failed"; readonly failure: SignInFailure };

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
    return { kind: "failed", failure: "network" };
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return { kind: "failed", failure: readRequestFailure(payload) };
  }

  const destination = readStringAt(payload, ["data", "destination"]);
  return destination !== null && SIGN_IN_DESTINATIONS.includes(destination)
    ? { kind: "signed-in", destination }
    : { kind: "failed", failure: "unrecognized_response" };
}

/** La sesión responde 401 a unas credenciales que no valen y 403 a una cuenta
 * que existe pero no puede entrar. Cualquier otra cosa no le dice a quien
 * mira nada que pueda arreglar desde aquí. */
function describeFailure(
  translate: Translator,
  failure: SignInFailure,
): string {
  switch (failure) {
    case "empty_credentials":
      return translate("auth.signIn.emptyCredentials");
    case "network":
      return translate("auth.error.network");
    case "unauthenticated":
      return translate("auth.signIn.invalidCredentials");
    case "forbidden":
      return translate("auth.signIn.accountUnavailable");
    default:
      return translate("auth.signIn.unexpected");
  }
}

const EMAIL_FIELD_ID = "entrar-email";
const PASSWORD_FIELD_ID = "entrar-password";

export function SignInForm({ locale }: { locale: Locale }): React.JSX.Element {
  const router = useRouter();
  const translate = createTranslator(locale);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "editing" });

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (email.trim() === "" || password === "") {
      setStatus({ kind: "failed", failure: "empty_credentials" });
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
      <h1>{translate("auth.signIn.title")}</h1>
      <p className="auth-lead">{translate("auth.signIn.lead")}</p>

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

      <div className="auth-field">
        <label htmlFor={PASSWORD_FIELD_ID}>
          {translate("auth.field.password")}
        </label>
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
        {translate("auth.signIn.forgotPassword")}
      </Link>

      <button
        type="submit"
        className="auth-submit"
        disabled={status.kind === "submitting"}
      >
        {translate("auth.signIn.submit")}
      </button>

      <p className="auth-note">
        {translate("auth.signIn.firstTime")}{" "}
        <Link href={REGISTRATION_PATH}>
          {translate("auth.signIn.createAccount")}
        </Link>
      </p>
    </form>
  );
}
