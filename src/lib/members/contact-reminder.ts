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
