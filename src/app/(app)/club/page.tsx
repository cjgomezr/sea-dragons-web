import type { Metadata } from "next";
import { ClubSettingsScreen } from "@/components/club/ClubSettingsScreen";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/**
 * La configuración del club (#296, RF-6 del PRD de E18a): nombre, iniciales,
 * acento y logo.
 *
 * `RESTRICTED_ROUTES` la reserva al Admin: a los demás la frontera los manda
 * al panel antes de llegar aquí. Lo que se enseña lo lee la pantalla del
 * endpoint de la configuración, que lo vuelve a comprobar.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("clubSettings.metaTitle", { club }),
    description: translate("clubSettings.metaDescription"),
  };
}

export default async function ClubSettingsPage(): Promise<React.JSX.Element> {
  return <ClubSettingsScreen locale={await readRequestLocale()} />;
}
