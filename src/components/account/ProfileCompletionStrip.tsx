"use client";

import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { useId } from "react";
import { formatPercent } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import {
  type MissingProfileItem,
  PERCENT_MAX,
  type ProfileCompleteness,
} from "@/lib/members/contact-reminder";
import { EMERGENCY_NAME_ID, PHONE_ID } from "./OwnContactSection";
import { COUNTRY_ID } from "./ProfileForm";

/**
 * La franja de lo que le falta al perfil (#771, D8 del PRD de E30), que
 * sustituye en el perfil al aviso de contacto (#498). Es una nota y no una
 * alerta: recuerda, no bloquea. Sale de la ficha guardada, así que se va en
 * cuanto el guardado refresca la página.
 *
 * Cada ficha lleva al primer campo de su dato. Mientras las tarjetas no
 * existan, ese campo es el del formulario de hoy. Es de cliente por el foco.
 */

const FIRST_FIELD_IDS = {
  emergency_contact: EMERGENCY_NAME_ID,
  phone: PHONE_ID,
  country: COUNTRY_ID,
} as const satisfies Record<MissingProfileItem, string>;

function focusFieldOf(item: MissingProfileItem): void {
  const field = document.getElementById(FIRST_FIELD_IDS[item]);
  if (field === null) {
    throw new Error(`Falta el campo ${FIRST_FIELD_IDS[item]} del perfil.`);
  }
  // El foco ya lo trae a la vista.
  field.focus();
}

export function ProfileCompletionStrip({
  locale,
  completeness,
}: {
  readonly locale: Locale;
  readonly completeness: ProfileCompleteness;
}): React.JSX.Element | null {
  const translate = createTranslator(locale);
  const titleId = useId();
  const { missing, percent } = completeness;
  if (missing.length === 0) {
    return null;
  }
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
          {formatPercent(locale, percent)}
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
            onClick={() => focusFieldOf(item)}
          >
            <Plus aria-hidden="true" weight="bold" />
            {translate(`profileCompletion.item.${item}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
