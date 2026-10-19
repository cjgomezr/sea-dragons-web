import type { ProfileContact } from "./profile-contact";

/**
 * El aviso que recuerda los datos de contacto que faltan (#498, RF-2 del PRD
 * de E19). El contacto de emergencia es obligatorio pero no bloquea nada
 * (D2): su aviso no se cierra hasta que se complete. El teléfono propio es un
 * favor que se pide, y su aviso sí se cierra. Cuando faltan los dos, un solo
 * aviso pide los dos.
 */

export type ContactReminder = "none" | "phone" | "emergency_contact" | "both";

export function contactReminderOf(contact: ProfileContact): ContactReminder {
  const isPhoneMissing = contact.phone === null;
  if (contact.emergencyContact !== null) {
    return isPhoneMissing ? "phone" : "none";
  }
  return isPhoneMissing ? "both" : "emergency_contact";
}

/** Sólo el del teléfono: mientras falte el contacto, el aviso se queda. */
export function isDismissibleReminder(reminder: ContactReminder): boolean {
  return reminder === "phone";
}

/** Lo que la franja del perfil (#771, D8 del PRD de E30) pide completar, en
 * el orden en que lo pide: primero lo obligatorio. */
export const MISSING_PROFILE_ITEMS = [
  "emergency_contact",
  "phone",
  "country",
] as const;

export type MissingProfileItem = (typeof MISSING_PROFILE_ITEMS)[number];

export type ProfileCompleteness = {
  readonly missing: readonly MissingProfileItem[];
  /** De 0 a 100, entero. */
  readonly percent: number;
};

/** El nombre y el correo: sin ellos no hay cuenta, así que siempre están y
 * cuentan como hechos. Por eso a quien le falta todo no le sale un 0. */
const ALWAYS_PRESENT_ITEMS = 2;
/** El porcentaje va de 0 a esto. */
export const PERCENT_MAX = 100;

const COUNTED_ITEMS = ALWAYS_PRESENT_ITEMS + MISSING_PROFILE_ITEMS.length;

const MISSING_CONTACT: Readonly<
  Record<ContactReminder, readonly MissingProfileItem[]>
> = {
  none: [],
  phone: ["phone"],
  emergency_contact: ["emergency_contact"],
  both: ["emergency_contact", "phone"],
};

/** Por ahora cuenta el contacto de emergencia, el teléfono y el país (D8);
 * los dos primeros, con la misma regla que el aviso de contacto. */
export function profileCompletenessOf(
  profile: ProfileContact & { readonly country: string | null },
): ProfileCompleteness {
  const missing: readonly MissingProfileItem[] = [
    ...MISSING_CONTACT[contactReminderOf(profile)],
    ...(profile.country === null ? (["country"] as const) : []),
  ];
  return {
    missing,
    percent: Math.round(
      ((COUNTED_ITEMS - missing.length) / COUNTED_ITEMS) * PERCENT_MAX,
    ),
  };
}
