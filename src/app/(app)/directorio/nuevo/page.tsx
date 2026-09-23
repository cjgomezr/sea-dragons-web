import type { Metadata } from "next";
import { NewMemberScreen } from "@/components/directory/NewMemberScreen";
import { listCountryOptions } from "@/lib/geo/countries";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/**
 * El alta de un miembro por un Admin (#243, RF-5 del PRD de E5), abierta desde
 * la cabecera del directorio.
 *
 * `RESTRICTED_ROUTES` la reserva a quien gestiona usuarios y roles: a los
 * demás la frontera los manda al panel antes de llegar aquí. El endpoint del
 * alta lo vuelve a comprobar.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("newMember.metaTitle", { club }),
    description: translate("newMember.metaDescription"),
  };
}

export default async function NewMemberPage(): Promise<React.JSX.Element> {
  const locale = await readRequestLocale();
  return (
    <NewMemberScreen locale={locale} countries={listCountryOptions(locale)} />
  );
}
