"use client";

import { ArrowLeft } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { goBackOrHome } from "@/components/go-back";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * La barra de arriba del perfil y de la ficha en el móvil (#777, RF-7 del
 * PRD de E30): 52 px con Volver, el título ("Mi perfil" o "Socio") y, para el
 * Admin en la ficha, su ⋯. Va bajo la cabecera de la app y se pega arriba al
 * hacer scroll, como la de una noticia (#601). Sin ⋯, la tercera columna
 * queda vacía y el título no se mueve.
 *
 * La ficha vuelve siempre al directorio, de donde se abre. El perfil se abre
 * desde el menú de la cuenta en cualquier pantalla: vuelve a la de antes o,
 * si se entró directo, al inicio.
 */

export type PhoneBarBack =
  | { readonly kind: "link"; readonly href: string }
  | { readonly kind: "history" };

const BACK_CLASS = "profile-phone-bar-button profile-phone-bar-back";

/** Aparte para que sólo el perfil pida el router: la ficha no lo usa. */
function HistoryBackButton({ label }: { label: string }): React.JSX.Element {
  const router = useRouter();
  return (
    <button
      type="button"
      className={BACK_CLASS}
      aria-label={label}
      title={label}
      onClick={() => goBackOrHome(router)}
    >
      <Icon glyph={ArrowLeft} />
    </button>
  );
}

export function ProfilePhoneBar({
  locale,
  title,
  back,
  more = null,
}: {
  locale: Locale;
  title: string;
  back: PhoneBarBack;
  /** El ⋯ del Admin, o null. */
  more?: React.ReactNode;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const backLabel = translate("profileBar.back");
  return (
    <nav className="profile-phone-bar" aria-label={title}>
      {back.kind === "link" ? (
        <Link
          href={back.href}
          className={BACK_CLASS}
          aria-label={backLabel}
          title={backLabel}
        >
          <Icon glyph={ArrowLeft} />
        </Link>
      ) : (
        <HistoryBackButton label={backLabel} />
      )}
      <span className="profile-phone-bar-title">{title}</span>
      {more}
    </nav>
  );
}
