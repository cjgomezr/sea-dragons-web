import type { Metadata } from "next";
import { NewMemberScreen } from "@/components/directory/NewMemberScreen";
import { listCountryOptions } from "@/lib/geo/countries";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * El alta de un miembro por un Admin (#243, RF-5 del PRD de E5), abierta desde
 * la cabecera del directorio.
 *
 * `RESTRICTED_ROUTES` la reserva a quien gestiona usuarios y roles: a los
 * demás la frontera los manda al panel antes de llegar aquí. El endpoint del
 * alta lo vuelve a comprobar.
 */

export async function generateMetadata(): Promise<Metadata> {
  const translate = createTranslator(await readRequestLocale());
  return {
    title: translate("newMember.metaTitle"),
    description: translate("newMember.metaDescription"),
  };
}

export default async function NewMemberPage(): Promise<React.JSX.Element> {
  const locale = await readRequestLocale();
  return (
    <NewMemberScreen locale={locale} countries={listCountryOptions(locale)} />
  );
}
