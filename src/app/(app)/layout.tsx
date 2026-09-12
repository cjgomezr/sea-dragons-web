import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";

/** La cáscara con menú lateral y barra de pestañas envuelve sólo las
 * pantallas de dentro de la aplicación. Las públicas de cuentas viven en el
 * grupo (auth) y tienen su propia disposición: un formulario de registro no
 * lleva el menú de siete secciones a las que todavía no se puede entrar. */
export default function AppLayout({
  children,
}: Readonly<{ children: ReactNode }>): React.JSX.Element {
  return <AppShell>{children}</AppShell>;
}
