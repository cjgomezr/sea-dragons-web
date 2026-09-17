import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/SignInForm";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { createTranslator } from "@/lib/i18n/translator";

export async function generateMetadata(): Promise<Metadata> {
  const translate = createTranslator(await readRequestLocale());
  return {
    title: translate("auth.signIn.metaTitle"),
    description: translate("auth.signIn.metaDescription"),
  };
}

export default async function SignInPage(): Promise<React.JSX.Element> {
  return <SignInForm locale={await readRequestLocale()} />;
}
