import type { ReactNode } from "react";
import { ClubBrandMark } from "@/components/ClubBrandMark";
import { ClubSocialLinks } from "@/components/ClubSocialLinks";
import { AuthBrandHeader } from "@/components/auth/AuthBrandHeader";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { clubSignInText } from "@/lib/club/sign-in-texts";
import { readClubBrand } from "@/lib/club/supabase-club-brand";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * Disposición de las pantallas públicas de cuentas, siguiendo
 * docs/mockups/auth-light.png: panel de marca a la izquierda y formulario a la
 * derecha. Por debajo de 768px el panel de marca se encoge a una cabecera,
 * para que el formulario empiece sin scroll en un móvil.
 *
 * El lema y el párrafo los escribe el club (#301); en un idioma en el que no
 * los escribió salen los del catálogo. Van como texto de React, que los
 * escapa: nunca se interpretan como HTML.
 *
 * Las redes del club (#964) van en el pie del panel de marca y, por debajo de
 * 768px, donde ese pie no se ve, al final de la columna del formulario. Las dos
 * copias están en la página; la hoja de estilos esconde la que no toca, y
 * escondida con `display: none` tampoco la oye un lector de pantalla.
 */

export default async function AuthLayout({
  children,
}: Readonly<{ children: ReactNode }>): Promise<React.JSX.Element> {
  const [locale, brand] = await Promise.all([
    readRequestLocale(),
    readClubBrand(),
  ]);
  const translate = createTranslator(locale);
  const tagline =
    clubSignInText(brand.signInTexts, locale, "tagline") ??
    translate("auth.brand.headline");
  const socialLinksProps = {
    links: brand.socialLinks,
    clubName: brand.name,
    locale,
  };
  const welcome =
    clubSignInText(brand.signInTexts, locale, "welcome") ??
    translate("auth.brand.copy");

  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <AuthBrandHeader
          signInLabel={translate("auth.brand.signInLink", { club: brand.name })}
        >
          <ClubBrandMark
            logoUrl={brand.logoUrl}
            logoAlt={translate("club.logoAlt", { club: brand.name })}
            fallback={
              <span className="auth-brand-mark" aria-hidden="true">
                {brand.initials}
              </span>
            }
          />
          <span className="auth-brand-name">{brand.name}</span>
        </AuthBrandHeader>
        <div className="auth-brand-pitch">
          <p className="auth-brand-eyebrow">
            {translate("auth.brand.eyebrow")}
          </p>
          <p className="auth-brand-headline">{tagline}</p>
          <p className="auth-brand-copy">{welcome}</p>
        </div>
        <div className="auth-brand-footer">
          <p>© 2026 {brand.name}</p>
          <ClubSocialLinks {...socialLinksProps} />
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-main-header">
          <ThemeToggle locale={locale} />
          <LanguageToggle locale={locale} />
        </div>
        {children}
        {/* Sin envoltorio: uno vacío sumaría un hueco más a la columna. */}
        <ClubSocialLinks {...socialLinksProps} className="auth-main-social" />
      </main>
    </div>
  );
}
