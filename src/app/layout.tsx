import type { Metadata, Viewport } from "next";
import { AccentStyle } from "@/components/AccentStyle";
import { ThemeScript } from "@/components/ThemeScript";
import { readClubBrand } from "@/lib/club/supabase-club-brand";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { createTranslator } from "@/lib/i18n/translator";
import "./globals.css";

// `viewportFit: "cover"` deja que iOS pinte bajo la raya de inicio y le da
// valor a `env(safe-area-inset-bottom)`, el hueco que reserva la barra de
// pestañas (#703). Declarar el viewport sustituye el de Next, así que repite
// el ancho y la escala que él ponía.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Es lo que enseñan los buscadores y las vistas previas de un enlace, así que
// sale del idioma de la visita y no de un `metadata` fijo.
export async function generateMetadata(): Promise<Metadata> {
  const [locale, brand] = await Promise.all([
    readRequestLocale(),
    readClubBrand(),
  ]);
  const translate = createTranslator(locale);
  return {
    title: brand.name,
    description: translate("app.metaDescription", { club: brand.name }),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): Promise<React.JSX.Element> {
  // El lector de pantalla pronuncia según este atributo, así que sale del
  // idioma de la visita y se decide aquí, antes de pintar.
  const [locale, brand] = await Promise.all([
    readRequestLocale(),
    readClubBrand(),
  ]);

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <ThemeScript />
        <AccentStyle accentColor={brand.accentColor} />
      </head>
      <body>{children}</body>
    </html>
  );
}
