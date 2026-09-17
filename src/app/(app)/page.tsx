import { readRequestLocale } from "@/lib/i18n/request-locale";
import { createTranslator } from "@/lib/i18n/translator";

const CLUB_NAME = "Victoria Seadragons";

export default async function HomePage(): Promise<React.JSX.Element> {
  const translate = createTranslator(await readRequestLocale());
  return (
    <>
      <h1>{CLUB_NAME}</h1>
      <p className="app-lead">{translate("home.lead")}</p>
      <section className="card" aria-labelledby="estado-titulo">
        <h2 id="estado-titulo">{translate("home.status.title")}</h2>
        <p>{translate("home.status.body")}</p>
        <a href="/api/v1/health" target="_blank" rel="noopener noreferrer">
          GET /api/v1/health
        </a>
      </section>
    </>
  );
}
