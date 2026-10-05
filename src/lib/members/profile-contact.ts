/**
 * El teléfono propio y el contacto de emergencia del perfil (#496, RF-1 del
 * PRD de E19), contados sin Supabase delante. Los dos son opcionales: no se
 * piden al crear la cuenta, y el aviso que los recuerda es otro ticket.
 *
 * Un teléfono se guarda tal como se escribió, sólo sin espacios sobrantes:
 * los socios son de varios países y no hay un formato que convenga a todos.
 * Lo que se exige es que sea un número que se pueda marcar. El contacto de
 * emergencia va entero o no va: un nombre sin teléfono no sirve a quien
 * tenga que llamar.
 *
 * `0057_member_contact.sql` cierra las mismas reglas en la base.
 */

export const PHONE_MIN_DIGITS = 8;
/** El máximo de E.164, que ya cuenta el prefijo del país. */
export const PHONE_MAX_DIGITS = 15;
/** Con los separadores. Ningún número real se acerca: sólo frena basura. */
export const PHONE_MAX_LENGTH = 30;
export const EMERGENCY_CONTACT_TEXT_MAX_LENGTH = 100;

/** Dígitos, espacios, guiones, paréntesis y un `+` sólo al principio. */
const DIALABLE_PHONE = /^\+?[0-9 ()-]+$/;

export type EmergencyContact = {
  readonly name: string;
  readonly phone: string;
  readonly relationship: string;
};

/** Lo que el perfil guarda: cada uno es null cuando no lo hay. */
export type ProfileContact = {
  readonly phone: string | null;
  readonly emergencyContact: EmergencyContact | null;
};

/** Lo que llega, sin validar. Un teléfono vacío es no tenerlo, y un contacto
 * con los tres datos vacíos también. */
export type ProfileContactSubmission = ProfileContact;

export const CONTACT_ISSUE_CODES = [
  "phone_invalid_characters",
  "phone_too_short",
  "phone_too_long",
  "emergency_contact_name_missing",
  "emergency_contact_name_too_long",
  "emergency_contact_phone_missing",
  "emergency_contact_phone_invalid_characters",
  "emergency_contact_phone_too_short",
  "emergency_contact_phone_too_long",
  "emergency_contact_relationship_missing",
  "emergency_contact_relationship_too_long",
] as const;

export type ContactIssueCode = (typeof CONTACT_ISSUE_CODES)[number];

export type ContactField =
  | "phone"
  | "emergencyContactName"
  | "emergencyContactPhone"
  | "emergencyContactRelationship";

export type ContactIssue = {
  readonly field: ContactField;
  readonly code: ContactIssueCode;
};

type PhoneProblem = "invalid_characters" | "too_short" | "too_long";

/** Cada teléfono tiene sus códigos, para que el `reason` de la API diga
 * además de qué está mal cuál de los dos lo está. */
const OWN_PHONE_CODES: Readonly<Record<PhoneProblem, ContactIssueCode>> = {
  invalid_characters: "phone_invalid_characters",
  too_short: "phone_too_short",
  too_long: "phone_too_long",
};

const EMERGENCY_PHONE_CODES: Readonly<Record<PhoneProblem, ContactIssueCode>> =
  {
    invalid_characters: "emergency_contact_phone_invalid_characters",
    too_short: "emergency_contact_phone_too_short",
    too_long: "emergency_contact_phone_too_long",
  };

/** Sin espacios en los extremos y uno solo entre grupos. */
export function normalizePhone(phone: string): string {
  return phone.trim().replace(/\s+/g, " ");
}

function digitsOf(phone: string): string {
  return phone.replace(/\D/g, "");
}

function phoneProblemOf(phone: string): PhoneProblem | null {
  const normalized = normalizePhone(phone);
  if (!DIALABLE_PHONE.test(normalized)) {
    return "invalid_characters";
  }
  const digitCount = digitsOf(normalized).length;
  if (digitCount < PHONE_MIN_DIGITS) {
    return "too_short";
  }
  return digitCount > PHONE_MAX_DIGITS || normalized.length > PHONE_MAX_LENGTH
    ? "too_long"
    : null;
}

/** El mismo número aunque se escriba con otros separadores. El formulario
 * avisa con esto de que el contacto debería ser otra persona. */
export function isSamePhone(first: string, second: string): boolean {
  const digits = digitsOf(first);
  return digits !== "" && digits === digitsOf(second);
}

function isBlank(text: string): boolean {
  return text.trim() === "";
}

function isBlankContact(contact: EmergencyContact): boolean {
  return (
    isBlank(contact.name) &&
    isBlank(contact.phone) &&
    isBlank(contact.relationship)
  );
}

/** Contados como `char_length`: un emoji es uno. */
function isTextTooLong(text: string): boolean {
  return [...text.trim()].length > EMERGENCY_CONTACT_TEXT_MAX_LENGTH;
}

function ownPhoneIssuesOf(phone: string | null): readonly ContactIssue[] {
  if (phone === null || isBlank(phone)) {
    return [];
  }
  const problem = phoneProblemOf(phone);
  return problem === null
    ? []
    : [{ field: "phone", code: OWN_PHONE_CODES[problem] }];
}

function textCodeOf(
  text: string,
  codes: {
    readonly missing: ContactIssueCode;
    readonly tooLong: ContactIssueCode;
  },
): ContactIssueCode | null {
  if (isBlank(text)) {
    return codes.missing;
  }
  return isTextTooLong(text) ? codes.tooLong : null;
}

function emergencyPhoneCodeOf(phone: string): ContactIssueCode | null {
  if (isBlank(phone)) {
    return "emergency_contact_phone_missing";
  }
  const problem = phoneProblemOf(phone);
  return problem === null ? null : EMERGENCY_PHONE_CODES[problem];
}

function emergencyContactIssuesOf(
  contact: EmergencyContact | null,
): readonly ContactIssue[] {
  if (contact === null || isBlankContact(contact)) {
    return [];
  }
  const checks: readonly [ContactField, ContactIssueCode | null][] = [
    [
      "emergencyContactName",
      textCodeOf(contact.name, {
        missing: "emergency_contact_name_missing",
        tooLong: "emergency_contact_name_too_long",
      }),
    ],
    ["emergencyContactPhone", emergencyPhoneCodeOf(contact.phone)],
    [
      "emergencyContactRelationship",
      textCodeOf(contact.relationship, {
        missing: "emergency_contact_relationship_missing",
        tooLong: "emergency_contact_relationship_too_long",
      }),
    ],
  ];
  return checks.flatMap(([field, code]) =>
    code === null ? [] : [{ field, code }],
  );
}

/** Todos los avisos a la vez. La usan el formulario, para ponerlos junto a
 * cada campo antes de enviar, y el dominio, para rechazar lo que llegue sin
 * pasar por él. */
export function contactIssuesOf(
  submission: ProfileContactSubmission,
): readonly ContactIssue[] {
  return [
    ...ownPhoneIssuesOf(submission.phone),
    ...emergencyContactIssuesOf(submission.emergencyContact),
  ];
}

/** Lo que se guarda de un envío que `contactIssuesOf` ya dio por bueno. */
export function toValidContact(
  submission: ProfileContactSubmission,
): ProfileContact {
  const { phone, emergencyContact } = submission;
  return {
    phone: phone === null || isBlank(phone) ? null : normalizePhone(phone),
    emergencyContact:
      emergencyContact === null || isBlankContact(emergencyContact)
        ? null
        : {
            name: emergencyContact.name.trim(),
            phone: normalizePhone(emergencyContact.phone),
            relationship: emergencyContact.relationship.trim(),
          },
  };
}
