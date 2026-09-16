import type { Metadata } from "next";
import { RegistrationConfirmationPanel } from "@/components/auth/RegistrationConfirmationPanel";
import { RegistrationForm } from "@/components/auth/RegistrationForm";
import {
  CONFIRMATION_QUERY_PARAM,
  parseConfirmationState,
} from "@/lib/auth/registration-screen";
import { listCountryOptions } from "@/lib/geo/countries";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { createTranslator } from "@/lib/i18n/translator";

export async function generateMetadata(): Promise<Metadata> {
  const translate = createTranslator(await readRequestLocale());
  return {
    title: translate("auth.registration.metaTitle"),
    description: translate("auth.registration.metaDescription"),
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
