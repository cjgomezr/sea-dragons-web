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

export const metadata: Metadata = {
  title: "Crear tu cuenta · Victoria Seadragons",
  description:
    "Regístrate en la plataforma del club Victoria Seadragons de rugby subacuático.",
};

const PAGE_LOCALE = "es";

type ConfirmationPanel = {
  readonly heading: string;
  readonly body: string;
  readonly note: string;
  /** Los desenlaces que sustituyen al formulario sin dejar nada que hacer
   * necesitan un camino de vuelta, o son un callejón sin salida. */
  readonly offersRetry: boolean;
};

const CONFIRMATION_PANELS: Record<ConfirmationState, ConfirmationPanel> = {
  ok: {
    heading: "Tu correo quedó confirmado",
    body: "Tu cuenta ya está activa. Cuando el inicio de sesión esté disponible podrás entrar con este correo y tu contraseña.",
    note: "No hace falta que hagas nada más.",
    offersRetry: false,
  },
  pendiente: {
    heading: "Tu correo quedó confirmado",
    body: "Todavía falta algún dato para que tu cuenta pueda operar, así que sigue incompleta. Te pediremos lo que falta antes de dejarte entrar.",
    note: "Te avisaremos en cuanto esa pantalla exista.",
    offersRetry: false,
  },
  invalida: {
    heading: "Este enlace ya no sirve",
    body: "El enlace de confirmación caducó o ya se usó. Vuelve a registrarte con el mismo correo y te mandaremos otro.",
    note: "Si el problema sigue, escribe al club.",
    offersRetry: true,
  },
  error: {
    heading: "No pudimos confirmar tu correo",
    // El enlace ya se consumió al intentarlo, así que "inténtalo otra vez" con
    // el mismo enlace no lleva a ninguna parte: hay que pedir uno nuevo.
    body: "Algo falló de nuestro lado, no en tu enlace. Ese enlace ya se gastó al intentarlo, así que vuelve a registrarte con el mismo correo y te mandaremos otro.",
    note: "Si el problema sigue, escribe al club.",
    offersRetry: true,
  },
};

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
      {panel.offersRetry && (
        <Link className="auth-back" href={REGISTRATION_PATH}>
          Volver al registro
        </Link>
      )}
    </section>
  );
}
