import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/** La cáscara con menú lateral y barra de pestañas envuelve sólo las
 * pantallas de dentro de la aplicación. Las públicas de cuentas viven en el
 * grupo (auth) y tienen su propia disposición: un formulario de registro no
 * lleva el menú de siete secciones a las que todavía no se puede entrar. */
export default async function AppLayout({
  children,
}: Readonly<{ children: ReactNode }>): Promise<React.JSX.Element> {
  const locale = await readRequestLocale();
  return <AppShell locale={locale}>{children}</AppShell>;
}
