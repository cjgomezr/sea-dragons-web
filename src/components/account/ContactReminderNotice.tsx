"use client";

import Link from "next/link";
import { useId, useState, useSyncExternalStore } from "react";
import { ACCOUNT_PAGE_PATH } from "@/lib/auth/routes";
import type { Locale } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/i18n/message";
import { createTranslator } from "@/lib/i18n/translator";
import {
  type ContactReminder,
  isDismissibleReminder,
} from "@/lib/members/contact-reminder";
import { CONTACT_SECTION_ID } from "./OwnContactSection";
import {
  dismissPhoneReminder,
  isPhoneReminderDismissed,
  subscribeToPhoneReminderDismissal,
} from "./phone-reminder-dismissal";

/**
 * El aviso de los datos de contacto que faltan (#498, RF-2 del PRD de E19),
 * igual en el inicio y en el perfil. Es una nota y no una alerta: recuerda,
 * no bloquea nada. Lleva a la sección "Contacto" del perfil. El del teléfono
 * se cierra; mientras falte el contacto de emergencia, no (D2).
 *
 * Es de cliente por el cierre del teléfono, que vive en el navegador.
 */

const CONTACT_SECTION_HREF = `${ACCOUNT_PAGE_PATH}#${CONTACT_SECTION_ID}`;

type ShownReminder = Exclude<ContactReminder, "none">;

const TITLE_KEYS = {
  emergency_contact: "contactReminder.emergencyContact.title",
  phone: "contactReminder.phone.title",
  both: "contactReminder.both.title",
} as const satisfies Record<ShownReminder, MessageKey>;

/** Cuando faltan los dos, el porqué es el del contacto: es el obligatorio. */
const WHY_KEYS = {
  emergency_contact: "contactReminder.emergencyContact.why",
  phone: "contactReminder.phone.why",
  both: "contactReminder.emergencyContact.why",
} as const satisfies Record<ShownReminder, MessageKey>;

/** En el servidor no se sabe si se cerró: el del teléfono sale al hidratar,
 * para no pintar uno que el socio ya cerró. */
function readServerDismissal(): boolean {
  return true;
}

function useIsPhoneReminderDismissed(userId: string): boolean {
  return useSyncExternalStore(
    subscribeToPhoneReminderDismissal,
    () => isPhoneReminderDismissed(userId),
    readServerDismissal,
  );
}

export function ContactReminderNotice({
  locale,
  userId,
  reminder,
}: {
  readonly locale: Locale;
  /** Quien mira: el cierre del teléfono es de su cuenta, no del navegador. */
  readonly userId: string;
  readonly reminder: ContactReminder;
}): React.JSX.Element | null {
  const translate = createTranslator(locale);
  const titleId = useId();
  const isStoredDismissed = useIsPhoneReminderDismissed(userId);
  // Sin almacenamiento, el cierre dura lo que dure la pantalla.
  const [isClosedHere, setIsClosedHere] = useState(false);
  if (reminder === "none") {
    return null;
  }
  const isDismissible = isDismissibleReminder(reminder);
  if (isDismissible && (isStoredDismissed || isClosedHere)) {
    return null;
  }

  function dismiss(): void {
    if (!dismissPhoneReminder(userId)) {
      setIsClosedHere(true);
    }
  }

  return (
    <div className="contact-reminder" role="note" aria-labelledby={titleId}>
      <div className="contact-reminder-text">
        <p className="contact-reminder-title" id={titleId}>
          {translate(TITLE_KEYS[reminder])}
        </p>
        <p>{translate(WHY_KEYS[reminder])}</p>
        <Link href={CONTACT_SECTION_HREF}>
          {translate("contactReminder.link")}
        </Link>
      </div>
      {isDismissible ? (
        <button
          type="button"
          className="contact-reminder-dismiss"
          aria-label={translate("contactReminder.dismissPhone")}
          onClick={dismiss}
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </div>
  );
}
