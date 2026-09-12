"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SignOutIcon } from "@/components/NavIcons";
import { SESSION_API_PATH, SIGN_IN_PATH } from "@/lib/auth/routes";

const LABEL = "Cerrar sesión";

/**
 * Cerrar sesión desde cualquier pantalla (FR-007): vive en la cabecera de la
 * cáscara, que es lo único que se dibuja igual en las siete secciones y en los
 * tres tamaños.
 *
 * Es un icono y no un botón con texto, como en el mockup del panel. Con texto
 * pesaba más que la propia navegación, que está justo debajo y es lo que la
 * gente usa todos los días. El nombre accesible sigue siendo el texto
 * completo, así que para un lector de pantalla no cambia nada.
 */
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
      aria-label={LABEL}
      title={LABEL}
    >
      <SignOutIcon />
    </button>
  );
}
