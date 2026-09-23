import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/SignInForm";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("auth.signIn.metaTitle", { club }),
    description: translate("auth.signIn.metaDescription", { club }),
  };
}

export default async function SignInPage(): Promise<React.JSX.Element> {
  return <SignInForm locale={await readRequestLocale()} />;
}
