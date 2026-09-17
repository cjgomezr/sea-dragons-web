import { formatCalendarDay } from "@/lib/i18n/format";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import {
  ALREADY_SET_ISSUE_CODE,
  type CompletionIssueCode,
} from "./complete-registration";
import {
  GUARDIAN_CONSENT_ISSUE_CODES,
  type GuardianConsentIssueCode,
} from "./guardian-consent";
import {
  EARLIEST_DATE_OF_BIRTH,
  FIELD_ISSUE_CODES,
  MEMBERSHIP_TYPES,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
} from "./registration";

/** Un campo que se pide porque falta y llegó vacío. Sólo lo dice el formulario
 * de completar registro, antes de preguntar al servidor. */
export const REQUIRED_ISSUE_CODE = "required";

export const AUTH_ISSUE_CODES = [
  ...FIELD_ISSUE_CODES,
  ALREADY_SET_ISSUE_CODE,
  ...GUARDIAN_CONSENT_ISSUE_CODES,
  REQUIRED_ISSUE_CODE,
] as const;

export type AuthIssueCode =
  CompletionIssueCode | GuardianConsentIssueCode | typeof REQUIRED_ISSUE_CODE;

/** La API sigue respondiendo en español, como antes de E17: quien la lee por
 * el mensaje es quien la depura. Las pantallas no leen esta frase; traducen
 * el código. */
const API_LOCALE = "es";

/** La frase de un código de validación en el idioma del traductor. La usan
 * las pantallas, con el idioma de quien mira, y la API, que sigue hablando en
 * español. Los datos (el mínimo, los tipos de membresía) salen de las mismas
 * constantes que aplican la regla, para que la frase no pueda desmentirla. */
export function describeAuthIssue(
  translate: Translator,
  code: AuthIssueCode,
): string {
  switch (code) {
    case "full_name_missing":
      return translate("auth.issue.fullNameMissing");
    case "email_malformed":
      return translate("auth.issue.emailMalformed");
    case "country_unknown":
      return translate("auth.issue.countryUnknown");
    case "password_too_short":
      return translate("auth.issue.passwordTooShort", {
        min: PASSWORD_MIN_LENGTH,
      });
    case "password_too_long":
      return translate("auth.issue.passwordTooLong", {
        max: PASSWORD_MAX_BYTES,
      });
    case "membership_type_unknown":
      return translate("auth.issue.membershipTypeUnknown", {
        types: MEMBERSHIP_TYPES.join(", "),
      });
    case "date_of_birth_not_a_date":
      return translate("auth.issue.dateOfBirthNotADate");
    case "date_of_birth_in_future":
      return translate("auth.issue.dateOfBirthInFuture");
    case "date_of_birth_too_early":
      return translate("auth.issue.dateOfBirthTooEarly", {
        earliest: formatCalendarDay(translate.locale, EARLIEST_DATE_OF_BIRTH),
      });
    case "already_set":
      return translate("auth.issue.alreadySet");
    case "guardian_name_missing":
      return translate("auth.issue.guardianNameMissing");
    case "guardian_email_malformed":
      return translate("auth.issue.guardianEmailMalformed");
    case "consent_missing":
      return translate("auth.issue.consentMissing");
    case "required":
      return translate("auth.issue.required");
  }
}

/** Los campos que no valen, en una frase para el mensaje de la API: "campo:
 * motivo" por cada uno, como la API respondía antes de que el dominio hablara
 * en códigos. */
export function describeIssuesForApi(
  issues: readonly { readonly field: string; readonly code: AuthIssueCode }[],
): string {
  const translate = createTranslator(API_LOCALE);
  return issues
    .map(
      (issue) => `${issue.field}: ${describeAuthIssue(translate, issue.code)}`,
    )
    .join(" ");
}
