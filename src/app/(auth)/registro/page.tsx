import type { Metadata } from "next";
import { RegistrationConfirmationPanel } from "@/components/auth/RegistrationConfirmationPanel";
import { RegistrationForm } from "@/components/auth/RegistrationForm";
import {
  CONFIRMATION_QUERY_PARAM,
  parseConfirmationState,
} from "@/lib/auth/registration-screen";
import { listCountryOptions } from "@/lib/geo/countries";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("auth.registration.metaTitle", { club }),
    description: translate("auth.registration.metaDescription", { club }),
  };
}

export default async function RegistrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const locale = await readRequestLocale();
  const state = parseConfirmationState(
    (await searchParams)[CONFIRMATION_QUERY_PARAM],
  );
  if (state === null) {
    return (
      <RegistrationForm
        locale={locale}
        countries={listCountryOptions(locale)}
      />
    );
  }
  return <RegistrationConfirmationPanel locale={locale} state={state} />;
}
