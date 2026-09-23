import type { Metadata } from "next";
import { PasswordRecoveryRequestForm } from "@/components/auth/PasswordRecoveryRequestForm";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("auth.passwordRecovery.metaTitle", { club }),
    description: translate("auth.passwordRecovery.metaDescription", { club }),
  };
}

export default async function PasswordRecoveryPage(): Promise<React.JSX.Element> {
  return <PasswordRecoveryRequestForm locale={await readRequestLocale()} />;
}
