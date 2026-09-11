import type { Metadata } from "next";
import { RegistrationForm } from "@/components/auth/RegistrationForm";
import {
  CONFIRMATION_QUERY_PARAM,
  type ConfirmationState,
  parseConfirmationState,
} from "@/lib/auth/registration-screen";

export const metadata: Metadata = {
  title: "Crear tu cuenta · Victoria Seadragons",
  description:
    "Regístrate en la plataforma del club Victoria Seadragons de rugby subacuático.",
};

type ConfirmationPanel = {
  readonly heading: string;
  readonly body: string;
  readonly tone: "ok" | "aviso";
};

const CONFIRMATION_PANELS: Record<ConfirmationState, ConfirmationPanel> = {
  ok: {
    heading: "Tu correo quedó confirmado",
    body: "Tu cuenta ya está activa. Cuando el inicio de sesión esté disponible podrás entrar con este correo y tu contraseña.",
    tone: "ok",
  },
  pendiente: {
    heading: "Tu correo quedó confirmado",
    body: "Todavía falta algún dato para que tu cuenta pueda operar, así que sigue incompleta. Te pediremos lo que falta antes de dejarte entrar.",
    tone: "aviso",
  },
  invalida: {
    heading: "Este enlace ya no sirve",
    body: "El enlace de confirmación caducó o ya se usó. Vuelve a registrarte con el mismo correo y te mandaremos otro.",
    tone: "aviso",
  },
  error: {
    heading: "No pudimos confirmar tu correo",
    body: "Algo falló de nuestro lado, no en tu enlace. Inténtalo otra vez en unos minutos.",
    tone: "aviso",
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
    return <RegistrationForm />;
  }

  const panel = CONFIRMATION_PANELS[state];
  return (
    <section className="auth-form" aria-labelledby="registro-estado-titulo">
      <h1 id="registro-estado-titulo">{panel.heading}</h1>
      <p className="auth-lead">{panel.body}</p>
      <p className={`auth-note auth-note-${panel.tone}`}>
        {panel.tone === "ok"
          ? "No hace falta que hagas nada más."
          : "Si el problema sigue, escribe al club."}
      </p>
    </section>
  );
}
