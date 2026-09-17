import type { Metadata } from "next";
import { PasswordRecoveryRequestForm } from "@/components/auth/PasswordRecoveryRequestForm";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { createTranslator } from "@/lib/i18n/translator";

export async function generateMetadata(): Promise<Metadata> {
  const translate = createTranslator(await readRequestLocale());
  return {
    title: translate("auth.passwordRecovery.metaTitle"),
    description: translate("auth.passwordRecovery.metaDescription"),
  };
}

export default async function PasswordRecoveryPage(): Promise<React.JSX.Element> {
  return <PasswordRecoveryRequestForm locale={await readRequestLocale()} />;
}
