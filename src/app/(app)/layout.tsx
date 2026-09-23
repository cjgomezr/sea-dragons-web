import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import type { Role } from "@/lib/auth/roles";
import { COMPLETE_REGISTRATION_PATH, SIGN_IN_PATH } from "@/lib/auth/routes";
import { readSessionState } from "@/lib/auth/session-reader";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { readClubBrand } from "@/lib/club/supabase-club-brand";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { readServerCookies } from "@/lib/supabase/server-cookies";
import { createSessionClient } from "@/lib/supabase/session-client";

/**
 * El rol con el que se dibuja la navegación (#213), leído aquí con la misma
 * lectura que usa la frontera y no pedido al navegador: una cookie o un prop
 * que el cliente pudiera tocar decidiría qué se le ofrece.
 *
 * La frontera ya dejó pasar sólo a una cuenta activa, así que los otros dos
 * casos son una carrera con ella (la sesión se cerró o cambió entre medias) y
 * se resuelven igual que ella los resolvería.
 */
async function readCallerRole(): Promise<Role> {
  const session = createSessionClient(process.env, await readServerCookies());
  if (session.kind === "unconfigured") {
    throw new Error(describeMissingAuthKeys(session.missingKeys));
  }
  const state = await readSessionState(session.client);
  switch (state.kind) {
    case "active":
      return state.role;
    case "incomplete":
      redirect(COMPLETE_REGISTRATION_PATH);
    case "anonymous":
      redirect(SIGN_IN_PATH);
  }
}

/** La cáscara con menú lateral y barra de pestañas envuelve sólo las
 * pantallas de dentro de la aplicación. Las públicas de cuentas viven en el
 * grupo (auth) y tienen su propia disposición: un formulario de registro no
 * lleva el menú de siete secciones a las que todavía no se puede entrar. */
export default async function AppLayout({
  children,
}: Readonly<{ children: ReactNode }>): Promise<React.JSX.Element> {
  const [locale, role, brand] = await Promise.all([
    readRequestLocale(),
    readCallerRole(),
    readClubBrand(),
  ]);
  return (
    <AppShell locale={locale} role={role} brand={brand}>
      {children}
    </AppShell>
  );
}
