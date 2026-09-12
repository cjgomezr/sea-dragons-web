"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SESSION_API_PATH, SIGN_IN_PATH } from "@/lib/auth/routes";

/** Cerrar sesión desde cualquier pantalla (FR-007): vive en la cabecera de la
 * cáscara, que es lo único que se dibuja igual en las siete secciones y en
 * los tres tamaños. */
export function SignOutButton(): React.JSX.Element {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut(): Promise<void> {
    setIsSigningOut(true);
    try {
      await fetch(SESSION_API_PATH, { method: "DELETE" });
    } catch (error) {
      // Quedarse dentro porque el servidor no contestó es peor que salir: la
      // frontera vuelve a preguntar en la siguiente petición y, si la sesión
      // sigue viva, la pantalla de entrada es el sitio desde donde volver.
      console.error("[cerrar sesión] el servidor no contestó", error);
    }
    router.replace(SIGN_IN_PATH);
    router.refresh();
  }

  return (
    <button
      type="button"
      className="app-signout"
      onClick={handleSignOut}
      disabled={isSigningOut}
    >
      Cerrar sesión
    </button>
  );
}
