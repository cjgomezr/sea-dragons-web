import type { Metadata } from "next";
import { MemberRecordScreen } from "@/components/directory/MemberRecordScreen";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * La ficha reservada al Admin de un miembro (#242, RF-4 del PRD de E5), que
 * se abre desde su fila del directorio. `[id]` es el `user_id` del miembro.
 *
 * `RESTRICTED_ROUTES` la reserva a quien gestiona usuarios y roles: a los
 * demás la frontera los manda al panel antes de llegar aquí. Lo que se enseña
 * lo lee la pantalla del endpoint de la ficha, que lo vuelve a comprobar.
 */

type MemberRecordPageProps = {
  readonly params: Promise<{ readonly id: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const translate = createTranslator(await readRequestLocale());
  return {
    title: translate("memberRecord.metaTitle"),
    description: translate("memberRecord.metaDescription"),
  };
}

export default async function MemberRecordPage({
  params,
}: MemberRecordPageProps): Promise<React.JSX.Element> {
  const { id } = await params;
  return (
    <MemberRecordScreen
      // Una ficha nueva empieza de cero: sin esto, pasar de un miembro a otro
      // dejaría a la vista el borrador del anterior.
      key={id}
      locale={await readRequestLocale()}
      userId={id}
    />
  );
}
