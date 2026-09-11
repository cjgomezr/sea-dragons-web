import { isKnownCountryCode } from "@/lib/geo/countries";
import { clubCalendarDate } from "@/lib/time/club-calendar";

/** FR-009: el conjunto es cerrado y lo cierran también la migración
 * `0003_members.sql` y este validador. La base es la última palabra; esto
 * existe para poder decir cuál era el campo malo antes de llegar a ella. */
export const MEMBERSHIP_TYPES = ["Full", "Student", "Casual"] as const;

export type MembershipType = (typeof MEMBERSHIP_TYPES)[number];

/** NFR-005 solo fija longitud mínima. No se inventa aquí ninguna otra regla de
 * contraseña: el PRD de E2 lo deja fuera de alcance a propósito. */
export const PASSWORD_MIN_LENGTH = 8;

/** Una fecha de nacimiento anterior a esta no es un socio, es una errata. */
export const EARLIEST_DATE_OF_BIRTH = "1900-01-01";

export type RegistrationRequest = {
  readonly fullName: string;
  readonly email: string;
  readonly country: string;
  readonly password: string;
  readonly membershipType: string;
  readonly dateOfBirth: string;
};

/** Lo mismo que `RegistrationRequest`, ya normalizado y con el tipo de
 * membresía estrechado: es lo único que el resto del registro acepta, para que
 * nadie pueda escribir en la base algo que no pasó por aquí. */
export type RegistrationDetails = {
  readonly fullName: string;
  readonly email: string;
  readonly country: string;
  readonly password: string;
  readonly membershipType: MembershipType;
  readonly dateOfBirth: string;
};

export type RegistrationField = keyof RegistrationRequest;

export type RegistrationIssue = {
  readonly field: RegistrationField;
  readonly message: string;
};

export type RegistrationValidation =
  | { readonly ok: true; readonly details: RegistrationDetails }
  | { readonly ok: false; readonly issues: readonly RegistrationIssue[] };

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
// Suficiente para descartar lo que no es un correo. Quién puede recibir de
// verdad lo decide el envío de la confirmación, no una expresión regular.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `true` solo si `value` es una fecha del calendario de verdad: `new Date`
 * acepta 2026-02-30 y la corre al 2 de marzo sin avisar. */
function isRealCalendarDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const [, year, month, day] = match;
  const parsed = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );
  return (
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() === Number(month) - 1 &&
    parsed.getUTCDate() === Number(day)
  );
}

function validateFullName(value: string): string | null {
  return value.trim().length === 0
    ? "El nombre completo es obligatorio."
    : null;
}

function validateEmail(value: string): string | null {
  return EMAIL_PATTERN.test(value.trim())
    ? null
    : "El correo no tiene una forma válida.";
}

function validateCountry(value: string): string | null {
  return isKnownCountryCode(value)
    ? null
    : "El país es obligatorio y debe ser un código ISO 3166-1 alfa-2 conocido.";
}

function validatePassword(value: string): string | null {
  return value.length < PASSWORD_MIN_LENGTH
    ? `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`
    : null;
}

/** Devuelve el tipo ya estrechado, o `undefined`. Buscarlo en la tupla en vez
 * de comprobar la pertenencia con un `includes` es lo que deja construir
 * `RegistrationDetails` sin un `as`. */
function findMembershipType(value: string): MembershipType | undefined {
  return MEMBERSHIP_TYPES.find((membershipType) => membershipType === value);
}

function validateDateOfBirth(value: string, now: Date): string | null {
  if (!isRealCalendarDate(value)) {
    return "La fecha de nacimiento debe existir en el calendario y escribirse como AAAA-MM-DD.";
  }
  if (value > clubCalendarDate(now)) {
    return "La fecha de nacimiento no puede estar en el futuro.";
  }
  if (value < EARLIEST_DATE_OF_BIRTH) {
    return `La fecha de nacimiento no puede ser anterior al ${EARLIEST_DATE_OF_BIRTH}.`;
  }
  return null;
}

/** Valida y normaliza una solicitud de registro. Devuelve TODOS los campos
 * inválidos, no el primero: el formulario los marca de una vez y quien llama a
 * la API no descubre los errores de uno en uno. */
export function validateRegistration(
  request: RegistrationRequest,
  options: { readonly now: Date },
): RegistrationValidation {
  const membershipType = findMembershipType(request.membershipType);
  const checks: readonly [RegistrationField, string | null][] = [
    ["fullName", validateFullName(request.fullName)],
    ["email", validateEmail(request.email)],
    ["country", validateCountry(request.country)],
    ["password", validatePassword(request.password)],
    [
      "membershipType",
      membershipType === undefined
        ? `El tipo de membresía debe ser uno de ${MEMBERSHIP_TYPES.join(", ")}.`
        : null,
    ],
    ["dateOfBirth", validateDateOfBirth(request.dateOfBirth, options.now)],
  ];

  const issues = checks.flatMap(([field, message]) =>
    message === null ? [] : [{ field, message }],
  );
  // El segundo término nunca es cierto sin el primero (si el tipo no existe,
  // `issues` ya lo recogió). Está aquí porque es lo que estrecha el tipo.
  if (issues.length > 0 || membershipType === undefined) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    details: {
      fullName: request.fullName.trim(),
      email: request.email.trim().toLowerCase(),
      country: request.country.trim().toUpperCase(),
      password: request.password,
      membershipType,
      dateOfBirth: request.dateOfBirth,
    },
  };
}
