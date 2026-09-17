import { SectionPlaceholder } from "@/components/SectionPlaceholder";
import { readRequestLocale } from "@/lib/i18n/request-locale";

export default async function DashboardPage(): Promise<React.JSX.Element> {
  return (
    <SectionPlaceholder
      locale={await readRequestLocale()}
      titleKey="nav.label.dashboard"
    />
  );
}
