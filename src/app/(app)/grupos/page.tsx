import type { Metadata } from "next";
import { GroupsScreen } from "@/components/groups/GroupsScreen";
import { readCallerRole } from "@/lib/auth/caller-role";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { canEmailFromDirectory } from "@/lib/directory/directory-email";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/**
 * La sección Grupos (#228, RF-2 a RF-7 del PRD de E4): los grupos del club con
 * su conteo y quién está en cada uno.
 *
 * Quién llega lo decide la frontera: `RESTRICTED_ROUTES` la reserva a la
 * capacidad de gestionar grupos, así que un Player acaba en el panel antes de
 * llegar aquí. Los datos los pide la pantalla a la API v1, no esta página: son
 * los mismos endpoints que usará la aplicación nativa de Release 2 (CON-002).
 *
 * Se llega desde la navegación, que sólo la ofrece a quien la frontera deja
 * pasar (#213).
 *
 * El rol se lee aquí, en el servidor, sólo para no ofrecerle al Coach
 * Escribir a todos (#830, D6): quien decide si el correo sale es el endpoint
 * del Directorio, que al Coach le responde 403.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("groups.metaTitle", { club }),
    description: translate("groups.metaDescription"),
  };
}

export default async function GroupsPage(): Promise<React.JSX.Element> {
  const [locale, role] = await Promise.all([
    readRequestLocale(),
    readCallerRole(),
  ]);
  return (
    <GroupsScreen
      locale={locale}
      canWriteEmails={canEmailFromDirectory(role)}
    />
  );
}
