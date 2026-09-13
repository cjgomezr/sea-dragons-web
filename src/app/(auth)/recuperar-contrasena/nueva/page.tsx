import type { Metadata } from "next";
import {
  NewPasswordForm,
  RecoveryLinkUnusable,
} from "@/components/auth/NewPasswordForm";
import { RESET_TOKEN_QUERY_PARAM } from "@/lib/auth/routes";

export const metadata: Metadata = {
  title: "Elige tu contraseña nueva · Victoria Seadragons",
  description:
    "Elige una contraseña nueva para tu cuenta del club Victoria Seadragons.",
  // La URL de esta pantalla lleva el token del enlace. Sin esto, cualquier
  // navegación que saliera de aquí se lo contaría al siguiente sitio en la
  // cabecera Referer.
  referrer: "no-referrer",
};

export default async function NewPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const tokenHash = (await searchParams)[RESET_TOKEN_QUERY_PARAM];
  if (typeof tokenHash !== "string" || tokenHash === "") {
    return <RecoveryLinkUnusable />;
  }
  return <NewPasswordForm tokenHash={tokenHash} />;
}
