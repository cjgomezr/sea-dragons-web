import type { Metadata } from "next";
import Link from "next/link";
import { RegistrationForm } from "@/components/auth/RegistrationForm";
import { listCountryOptions } from "@/lib/geo/countries";
import {
  CONFIRMATION_QUERY_PARAM,
  type ConfirmationState,
  REGISTRATION_PATH,
  parseConfirmationState,
} from "@/lib/auth/registration-screen";
import { SIGN_IN_PATH } from "@/lib/auth/routes";

export const metadata: Metadata = {
  title: "Crear tu cuenta · Victoria Seadragons",
  description:
    "Regístrate en la plataforma del club Victoria Seadragons de rugby subacuático.",
};

const PAGE_LOCALE = "es";

/** Cada desenlace sustituye al formulario, así que cada uno necesita una
 * salida o es un callejón sin salida: entrar si el correo quedó confirmado,
 * volver al registro si hay que pedir otro enlace. */
type ConfirmationAction = "sign-in" | "back-to-registration";

type ConfirmationPanel = {
  readonly heading: string;
  readonly body: string;
  readonly note: string;
  readonly action: ConfirmationAction;
};

const CONFIRMATION_PANELS: Record<ConfirmationState, ConfirmationPanel> = {
  ok: {
    heading: "Tu correo quedó confirmado",
    body: "Tu cuenta ya está activa. Entra con este correo y tu contraseña.",
    note: "Ya puedes usar la plataforma del club.",
    action: "sign-in",
  },
  pendiente: {
    heading: "Tu correo quedó confirmado",
    body: "Todavía falta algún dato para que tu cuenta pueda operar, así que sigue incompleta.",
    // El inicio de sesión ya manda a completar registro a una cuenta incompleta.
    note: "Entra con este correo y tu contraseña, y te pediremos lo que falta.",
    action: "sign-in",
  },
  invalida: {
    heading: "Este enlace ya no sirve",
    body: "El enlace de confirmación caducó o ya se usó. Vuelve a registrarte con el mismo correo y te mandaremos otro.",
    note: "Si el problema sigue, escribe al club.",
    action: "back-to-registration",
  },
  error: {
    heading: "No pudimos confirmar tu correo",
    // El enlace ya se consumió al intentarlo, así que "inténtalo otra vez" con
    // el mismo enlace no lleva a ninguna parte: hay que pedir uno nuevo.
    body: "Algo falló de nuestro lado, no en tu enlace. Ese enlace ya se gastó al intentarlo, así que vuelve a registrarte con el mismo correo y te mandaremos otro.",
    note: "Si el problema sigue, escribe al club.",
    action: "back-to-registration",
  },
};

function ConfirmationActionLink({
  action,
}: {
  action: ConfirmationAction;
}): React.JSX.Element {
  if (action === "sign-in") {
    return (
      <Link className="auth-submit auth-submit-link" href={SIGN_IN_PATH}>
        Entrar
      </Link>
    );
  }
  return (
    <Link className="auth-back" href={REGISTRATION_PATH}>
      Volver al registro
    </Link>
  );
}

export default async function RegistrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const state = parseConfirmationState(
    (await searchParams)[CONFIRMATION_QUERY_PARAM],
  );
  if (state === null) {
    return <RegistrationForm countries={listCountryOptions(PAGE_LOCALE)} />;
  }

  const panel = CONFIRMATION_PANELS[state];
  return (
    <section className="auth-form" aria-labelledby="registro-estado-titulo">
      <h1 id="registro-estado-titulo">{panel.heading}</h1>
      <p className="auth-lead">{panel.body}</p>
      <p className="auth-note">{panel.note}</p>
      <ConfirmationActionLink action={panel.action} />
    </section>
  );
}
