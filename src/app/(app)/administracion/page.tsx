import type { Metadata } from "next";
import { AdministrationScreen } from "@/components/administration/AdministrationScreen";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * La pantalla mínima de administración (#212, RF-8 del PRD de E3): la bandeja
 * de solicitudes pendientes y la lista de socios con su rol. E5 la absorberá
 * en el directorio completo.
 *
 * Quién llega lo decide la frontera: `RESTRICTED_ROUTES` la reserva a la
 * capacidad de gestionar usuarios y roles, así que cualquier otro rol acaba en
 * el panel antes de llegar aquí. Los datos los pide la pantalla a la API v1,
 * no esta página: son los mismos endpoints que usará la aplicación nativa de
 * Release 2 (CON-002).
 *
 * A la pantalla se llega hoy escribiendo la dirección: la entrada en el menú
 * es de su propio ticket.
 */

export async function generateMetadata(): Promise<Metadata> {
  const translate = createTranslator(await readRequestLocale());
  return {
    title: translate("admin.metaTitle"),
    description: translate("admin.metaDescription"),
  };
}

export default async function AdministrationPage(): Promise<React.JSX.Element> {
  return <AdministrationScreen locale={await readRequestLocale()} />;
}
