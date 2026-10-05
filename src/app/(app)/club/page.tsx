import type { Metadata } from "next";
import { ClubSettingsScreen } from "@/components/club/ClubSettingsScreen";
import { readCallerRole } from "@/lib/auth/caller-role";
import { hasCapability } from "@/lib/auth/roles";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/**
 * La configuración del club (#296, RF-6 del PRD de E18a): nombre, iniciales,
 * acento y logo, y los packs de sesiones (#469).
 *
 * `RESTRICTED_ROUTES` la reserva al Admin y al Committee: a los demás la
 * frontera los manda al panel antes de llegar aquí. El rol sólo decide qué
 * secciones se pintan; cada una lee de su endpoint, que lo vuelve a
 * comprobar.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("clubSettings.metaTitle", { club }),
    description: translate("clubSettings.metaDescription"),
  };
}

export default async function ClubSettingsPage(): Promise<React.JSX.Element> {
  const [locale, role] = await Promise.all([
    readRequestLocale(),
    readCallerRole(),
  ]);
  return (
    <ClubSettingsScreen
      locale={locale}
      // La matriz del SRD no tiene una fila para configurar el club, y la
      // única que es sólo del Admin es esta.
      canManageClub={hasCapability(role, "manageUsersAndRoles")}
    />
  );
}
