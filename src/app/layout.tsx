import type { Metadata } from "next";
import { ThemeScript } from "@/components/ThemeScript";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import "./globals.css";

export const metadata: Metadata = {
  title: "Victoria Seadragons",
  description:
    "Plataforma del club de rugby subacuático Victoria Seadragons (Melbourne).",
};

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
