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
 * `menu` es el del menú de la cuenta (#287): una entrada más de la lista, con
 * su icono y su texto, porque ahí ya no compite por el ancho de la cabecera.
 *
 * `text` es el de completar registro (#133). Esa pantalla no tiene cáscara ni
 * navegación, y cerrar sesión es una de las dos únicas cosas que una cuenta
 * incompleta puede hacer: esconderla detrás de un icono suelto sería esconder
 * media pantalla.
 */
export type SignOutAppearance = "menu" | "text";

/**
 * Cerrar sesión desde cualquier pantalla (FR-007). El comportamiento es uno
 * solo y vive aquí; lo único que cambia entre sitios es cómo se dibuja.
 */
export function SignOutButton({
  locale,
  appearance = "menu",
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

  const isMenuItem = appearance === "menu";
  return (
    <button
      type="button"
      className={isMenuItem ? "account-menu-item" : "auth-signout"}
      onClick={handleSignOut}
      disabled={isSigningOut}
    >
      {isMenuItem ? <SignOutIcon /> : null}
      {label}
    </button>
  );
}
