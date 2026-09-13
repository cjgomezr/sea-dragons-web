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

/** El máximo no es una política nuestra, es el de bcrypt, que es con lo que
 * GoTrue guarda la contraseña. Sin esta comprobación el rechazo llegaría desde
 * el servicio de autenticación, donde ya no se sabe qué campo era, y el
 * visitante recibiría un 500 genérico en vez de "revisa la contraseña".
 *
 * Se mide en BYTES y no en caracteres porque así lo mide bcrypt: 40 letras
 * acentuadas son 80 bytes en UTF-8 y las rechazaría igual. El mínimo sí va en
 * caracteres, porque ese sí es una política nuestra (NFR-005). */
export const PASSWORD_MAX_BYTES = 72;

const PASSWORD_ENCODER = new TextEncoder();

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

/** Suficiente para descartar lo que no es una dirección. Lo comparten el
 * registro y el reenvío de la confirmación, para que las dos puertas exijan lo
 * mismo. */
export function looksLikeEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

function validateEmail(value: string): string | null {
  return looksLikeEmail(value) ? null : "El correo no tiene una forma válida.";
}

/**
 * El resultado de validar UN campo: o vale, ya normalizado y con el tipo
 * estrechado, o no vale y dice por qué.
 *
 * Existe porque estos tres campos se validan en dos sitios: el registro, que
 * los pide todos, y la pantalla de completar registro, que pide sólo los que
 * falten. Devolver el valor normalizado junto al veredicto es lo que impide
 * que el segundo sitio se escriba su propia copia del `trim`.
 */
export type FieldValidation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

export function validateCountryField(value: string): FieldValidation<string> {
  return isKnownCountryCode(value)
    ? { ok: true, value: value.trim().toUpperCase() }
    : {
        ok: false,
        message:
          "El país es obligatorio y debe ser un código ISO 3166-1 alfa-2 conocido.",
      };
}

/** Exportada porque la recuperación de contraseña (RF-6) exige el mismo
 * mínimo que el registro, con el mismo mensaje. Una segunda copia de la regla
 * sería una segunda política de contraseñas esperando a divergir. */
export function validatePasswordField(value: string): FieldValidation<string> {
  if (value.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      message: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    };
  }
  return PASSWORD_ENCODER.encode(value).length > PASSWORD_MAX_BYTES
    ? {
        ok: false,
        message: `La contraseña no puede pasar de ${PASSWORD_MAX_BYTES} caracteres (las letras acentuadas y los emojis cuentan doble).`,
      }
    : { ok: true, value };
}

/** Buscar el valor en la tupla en vez de comprobar la pertenencia con un
 * `includes` es lo que deja construir `RegistrationDetails` sin un `as`. */
export function validateMembershipTypeField(
  value: string,
): FieldValidation<MembershipType> {
  const membershipType = MEMBERSHIP_TYPES.find(
    (candidate) => candidate === value,
  );
  return membershipType === undefined
    ? {
        ok: false,
        message: `El tipo de membresía debe ser uno de ${MEMBERSHIP_TYPES.join(", ")}.`,
      }
    : { ok: true, value: membershipType };
}

export function validateDateOfBirthField(
  value: string,
  now: Date,
): FieldValidation<string> {
  if (!isRealCalendarDate(value)) {
    return {
      ok: false,
      message:
        "La fecha de nacimiento debe existir en el calendario y escribirse como AAAA-MM-DD.",
    };
  }
  if (value > clubCalendarDate(now)) {
    return {
      ok: false,
      message: "La fecha de nacimiento no puede estar en el futuro.",
    };
  }
  if (value < EARLIEST_DATE_OF_BIRTH) {
    return {
      ok: false,
      message: `La fecha de nacimiento no puede ser anterior al ${EARLIEST_DATE_OF_BIRTH}.`,
    };
  }
  return { ok: true, value };
}

/** El mensaje de un campo que no vale, o `null` si vale. Es la forma que pide
 * la lista de comprobaciones del registro. */
function messageOf(validation: FieldValidation<unknown>): string | null {
  return validation.ok ? null : validation.message;
}

/** Valida y normaliza una solicitud de registro. Devuelve TODOS los campos
 * inválidos, no el primero: el formulario los marca de una vez y quien llama a
 * la API no descubre los errores de uno en uno. */
export function validateRegistration(
  request: RegistrationRequest,
  options: { readonly now: Date },
): RegistrationValidation {
  const country = validateCountryField(request.country);
  const membershipType = validateMembershipTypeField(request.membershipType);
  const dateOfBirth = validateDateOfBirthField(
    request.dateOfBirth,
    options.now,
  );
  const checks: readonly [RegistrationField, string | null][] = [
    ["fullName", validateFullName(request.fullName)],
    ["email", validateEmail(request.email)],
    ["country", messageOf(country)],
    ["password", messageOf(validatePasswordField(request.password))],
    ["membershipType", messageOf(membershipType)],
    ["dateOfBirth", messageOf(dateOfBirth)],
  ];

  const issues = checks.flatMap(([field, message]) =>
    message === null ? [] : [{ field, message }],
  );
  // Los tres últimos términos no pueden ser ciertos sin el primero: si alguno
  // de esos campos no valía, `issues` ya lo recogió. Están aquí porque son los
  // que estrechan el tipo.
  if (
    issues.length > 0 ||
    !country.ok ||
    !membershipType.ok ||
    !dateOfBirth.ok
  ) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    details: {
      fullName: request.fullName.trim(),
      email: request.email.trim().toLowerCase(),
      country: country.value,
      password: request.password,
      membershipType: membershipType.value,
      dateOfBirth: dateOfBirth.value,
    },
  };
}
