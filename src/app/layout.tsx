import type { Metadata } from "next";
import { ThemeScript } from "@/components/ThemeScript";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { createTranslator } from "@/lib/i18n/translator";
import "./globals.css";

// Es lo que enseñan los buscadores y las vistas previas de un enlace, así que
// sale del idioma de la visita y no de un `metadata` fijo.
export async function generateMetadata(): Promise<Metadata> {
  const translate = createTranslator(await readRequestLocale());
  return {
    title: "Victoria Seadragons",
    description: translate("app.metaDescription"),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): Promise<React.JSX.Element> {
  // El lector de pantalla pronuncia según este atributo, así que sale del
  // idioma de la visita y se decide aquí, antes de pintar.
  const locale = await readRequestLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  );
}
