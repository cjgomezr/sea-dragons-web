"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SignOutIcon } from "@/components/NavIcons";
import { SESSION_API_PATH, SIGN_IN_PATH } from "@/lib/auth/routes";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * Cómo se dibuja el control, que no es cómo se comporta.
 *
 * `icon` es el de la cabecera de la cáscara: ahí compite con la navegación,
 * que es lo que la gente usa todos los días, y con texto pesaba más que ella.
 * El nombre accesible sigue siendo el texto completo, así que para un lector
 * de pantalla los dos son lo mismo.
 *
 * `text` es el de completar registro (#133). Esa pantalla no tiene cáscara ni
 * navegación, y cerrar sesión es una de las dos únicas cosas que una cuenta
 * incompleta puede hacer: esconderla detrás de un icono suelto sería esconder
 * media pantalla.
 */
export type SignOutAppearance = "icon" | "text";

/**
 * Cerrar sesión desde cualquier pantalla (FR-007). El comportamiento es uno
 * solo y vive aquí; lo único que cambia entre sitios es cómo se dibuja.
 */
export function SignOutButton({
  locale,
  appearance = "icon",
}: {
  locale: Locale;
  appearance?: SignOutAppearance;
}): React.JSX.Element {
  const router = useRouter();
  const label = createTranslator(locale)("signOut.label");
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

  const isIcon = appearance === "icon";
  return (
    <button
      type="button"
      className={isIcon ? "app-signout" : "auth-signout"}
      onClick={handleSignOut}
      disabled={isSigningOut}
      {...(isIcon ? { "aria-label": label, title: label } : {})}
    >
      {isIcon ? <SignOutIcon /> : label}
    </button>
  );
}
