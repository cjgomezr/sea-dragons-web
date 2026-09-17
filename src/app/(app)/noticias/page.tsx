import { SectionPlaceholder } from "@/components/SectionPlaceholder";
import { readRequestLocale } from "@/lib/i18n/request-locale";

export default async function NoticiasPage(): Promise<React.JSX.Element> {
  return (
    <SectionPlaceholder
      locale={await readRequestLocale()}
      titleKey="nav.label.news"
    />
  );
}
