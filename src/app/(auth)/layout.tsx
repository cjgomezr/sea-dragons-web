import type { ReactNode } from "react";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * Disposición de las pantallas públicas de cuentas, siguiendo
 * docs/mockups/auth-light.png: panel de marca a la izquierda y formulario a la
 * derecha. Por debajo de 768px el panel de marca se encoge a una cabecera,
 * para que el formulario empiece sin scroll en un móvil.
 */

const CLUB_NAME = "Victoria Seadragons";
const CLUB_INITIALS = "VS";

export default async function AuthLayout({
  children,
}: Readonly<{ children: ReactNode }>): Promise<React.JSX.Element> {
  const locale = await readRequestLocale();
  const translate = createTranslator(locale);

  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <div className="auth-brand-header">
          <span className="auth-brand-mark" aria-hidden="true">
            {CLUB_INITIALS}
          </span>
          <span className="auth-brand-name">{CLUB_NAME}</span>
        </div>
        <div className="auth-brand-pitch">
          <p className="auth-brand-eyebrow">
            {translate("auth.brand.eyebrow")}
          </p>
          <p className="auth-brand-headline">
            {translate("auth.brand.headline")}
          </p>
          <p className="auth-brand-copy">{translate("auth.brand.copy")}</p>
        </div>
        <p className="auth-brand-footer">© 2026 Victoria Seadragons UWR Club</p>
      </aside>
      <main className="auth-main">
        <div className="auth-main-header">
          <ThemeToggle locale={locale} />
          <LanguageToggle locale={locale} />
        </div>
        {children}
      </main>
    </div>
  );
}
