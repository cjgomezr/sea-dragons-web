"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SIGN_IN_PATH } from "@/lib/auth/routes";

/**
 * La cabecera de marca de las pantallas de cuenta (#478). Fuera de entrar es
 * la vuelta al inicio de sesión. En entrar no es enlace: llevaría a la misma
 * pantalla y podría borrar lo que la persona ya escribió.
 *
 * Es de cliente sólo por `usePathname`: un layout no sabe en qué página está.
 * El nombre accesible lo pone `signInLabel`, porque el del logo solo diría
 * qué imagen es y no adónde lleva.
 */
export function AuthBrandHeader({
  signInLabel,
  children,
}: {
  signInLabel: string;
  children: ReactNode;
}): React.JSX.Element {
  const isSignInPage = usePathname() === SIGN_IN_PATH;
  if (isSignInPage) {
    return <div className="auth-brand-header">{children}</div>;
  }
  return (
    <Link
      className="auth-brand-header"
      href={SIGN_IN_PATH}
      aria-label={signInLabel}
    >
      {children}
    </Link>
  );
}
