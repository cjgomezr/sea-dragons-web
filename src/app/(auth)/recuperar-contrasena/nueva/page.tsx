import type { Metadata } from "next";
import {
  NewPasswordForm,
  RecoveryLinkUnusable,
} from "@/components/auth/NewPasswordForm";
import { RESET_TOKEN_QUERY_PARAM } from "@/lib/auth/routes";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("auth.newPassword.metaTitle", { club }),
    description: translate("auth.newPassword.metaDescription", { club }),
    // La URL de esta pantalla lleva el token del enlace. Sin esto, cualquier
    // navegación que saliera de aquí se lo contaría al siguiente sitio en la
    // cabecera Referer.
    referrer: "no-referrer",
  };
}

export default async function NewPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const locale = await readRequestLocale();
  const tokenHash = (await searchParams)[RESET_TOKEN_QUERY_PARAM];
  if (typeof tokenHash !== "string" || tokenHash === "") {
    return <RecoveryLinkUnusable locale={locale} />;
  }
  return <NewPasswordForm locale={locale} tokenHash={tokenHash} />;
}
