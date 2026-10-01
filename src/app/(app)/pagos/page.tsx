import { MembershipNotice } from "@/components/MembershipNotice";
import { SectionPlaceholder } from "@/components/SectionPlaceholder";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { createTranslator } from "@/lib/i18n/translator";
import { readCallerMembershipBlock } from "@/lib/membership/caller-membership";

/** Pagos, todavía como marcador (#455 trae la pantalla). Es a donde la
 * frontera lleva a quien no tiene la membresía al día (#453), así que ya le
 * dice por qué. */
export default async function PagosPage(): Promise<React.JSX.Element> {
  const [locale, block] = await Promise.all([
    readRequestLocale(),
    readCallerMembershipBlock(),
  ]);
  return (
    <>
      <SectionPlaceholder locale={locale} titleKey="nav.label.payments" />
      {block === null ? null : (
        <MembershipNotice
          translate={createTranslator(locale)}
          block={block}
          linksToPayments={false}
        />
      )}
    </>
  );
}
