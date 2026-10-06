import { readRequiredText, readText } from "@/lib/auth/supabase-auth-gateways";
import type { EmergencyContact, ProfileContact } from "./profile-contact";

/**
 * Cómo se leen y se escriben en `members` el teléfono y el contacto de
 * emergencia (#496). Lo comparten el perfil propio, la ficha del Admin y el
 * directorio (#499), para que los tres entiendan las columnas de
 * `0058_member_contact.sql` igual.
 */

const MEMBERS_TABLE = "members";

export const CONTACT_COLUMNS =
  "phone, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship";

type Row = Record<string, unknown>;

/** El `check` `members_emergency_contact_complete` de `0058` garantiza
 * que estén las tres o ninguna. */
export function readEmergencyContact(row: Row): EmergencyContact | null {
  const name = readText(row, "emergency_contact_name", MEMBERS_TABLE);
  if (name === null) {
    return null;
  }
  return {
    name,
    phone: readRequiredText(row, "emergency_contact_phone", MEMBERS_TABLE),
    relationship: readRequiredText(
      row,
      "emergency_contact_relationship",
      MEMBERS_TABLE,
    ),
  };
}

export function readProfileContact(row: Row): ProfileContact {
  return {
    phone: readText(row, "phone", MEMBERS_TABLE),
    emergencyContact: readEmergencyContact(row),
  };
}

/** Sin contacto, las tres a null: el `check` de `0058` no deja otra. */
export function toContactColumns(
  contact: ProfileContact,
): Record<string, string | null> {
  const { phone, emergencyContact } = contact;
  return {
    phone,
    emergency_contact_name:
      emergencyContact === null ? null : emergencyContact.name,
    emergency_contact_phone:
      emergencyContact === null ? null : emergencyContact.phone,
    emergency_contact_relationship:
      emergencyContact === null ? null : emergencyContact.relationship,
  };
}
