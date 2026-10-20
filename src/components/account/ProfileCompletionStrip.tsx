"use client";

import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { useId } from "react";
import { useIsPhone } from "@/components/use-is-phone";
import { formatPercent } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import {
  type MissingProfileItem,
  PERCENT_MAX,
  type ProfileCompleteness,
} from "@/lib/members/contact-reminder";

/**
 * La franja de lo que le falta al perfil (#771, D8 del PRD de E30), que
 * sustituye en el perfil al aviso de contacto (#498). Es una nota y no una
 * alerta: recuerda, no bloquea. Sale de la ficha guardada, así que se va en
 * cuanto el guardado refresca la página.
 *
 * Cada ficha abre la tarjeta de su dato con el foco en su primer campo
 * (#772); qué tarjeta y qué campo lo decide quien la pinta. Es de cliente por
 * el clic.
 *
 * En el móvil (#777) es una tarjeta: "Casi listo · {pct} completo" y una
 * fila de 44 px por dato, sin el anillo.
 */

type StripProps = {
  readonly translate: Translator;
  readonly completeness: ProfileCompleteness;
  readonly onAdd: (item: MissingProfileItem) => void;
};

function PhoneCompletionCard({
  translate,
  completeness,
  onAdd,
}: StripProps): React.JSX.Element {
  const titleId = useId();
  return (
    <div
      className="profile-strip profile-strip-warning profile-missing-card"
      role="note"
      aria-labelledby={titleId}
    >
      <p className="profile-strip-text" id={titleId}>
        {translate("profileCompletion.phoneTitle", {
          percent: formatPercent(translate.locale, completeness.percent),
        })}
      </p>
      {completeness.missing.map((item) => (
        <button
          key={item}
          type="button"
          className="profile-missing-row"
          onClick={() => onAdd(item)}
        >
          <Plus aria-hidden="true" weight="bold" />
          <span className="profile-missing-row-label">
            {translate(`profileCompletion.item.${item}`)}
          </span>
          <CaretRight aria-hidden="true" weight="regular" />
        </button>
      ))}
    </div>
  );
}

function DesktopCompletionStrip({
  translate,
  completeness,
  onAdd,
}: StripProps): React.JSX.Element {
  const titleId = useId();
  const { missing, percent } = completeness;
  return (
    <div
      className="profile-strip profile-strip-warning"
      role="note"
      aria-labelledby={titleId}
    >
      <span
        className="profile-progress"
        role="progressbar"
        aria-label={translate("profileCompletion.progress")}
        aria-valuemin={0}
        aria-valuemax={PERCENT_MAX}
        aria-valuenow={percent}
        style={{ "--profile-progress": `${percent}%` } as React.CSSProperties}
      >
        <span className="profile-progress-value" aria-hidden="true">
          {formatPercent(translate.locale, percent)}
        </span>
      </span>
      <p className="profile-strip-text" id={titleId}>
        {translate("profileCompletion.title")}
      </p>
      <div className="profile-strip-actions">
        {missing.map((item) => (
          <button
            key={item}
            type="button"
            className="profile-missing-chip"
            onClick={() => onAdd(item)}
          >
            <Plus aria-hidden="true" weight="bold" />
            {translate(`profileCompletion.item.${item}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ProfileCompletionStrip({
  locale,
  completeness,
  onAdd,
}: {
  readonly locale: Locale;
  readonly completeness: ProfileCompleteness;
  readonly onAdd: (item: MissingProfileItem) => void;
}): React.JSX.Element | null {
  const translate = createTranslator(locale);
  const isPhone = useIsPhone();
  if (completeness.missing.length === 0) {
    return null;
  }
  const Strip = isPhone ? PhoneCompletionCard : DesktopCompletionStrip;
  return (
    <Strip translate={translate} completeness={completeness} onAdd={onAdd} />
  );
}
