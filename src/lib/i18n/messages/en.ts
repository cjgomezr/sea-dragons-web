import type { Message } from "../message";

/** Claves de ejemplo hasta que los tickets de traducción de E17 traigan las
 * de cada pantalla. */
export const englishMessages = {
  "auth.passwordRecovery.checkEmailTitle": "Check your email",
  "auth.passwordRecovery.linkSent":
    "If {email} has a club account, we sent it a link to choose a new password.",
  "auth.emailRequest.retryAfter": {
    one: "{count} minute to go before you can ask for another link.",
    other: "{count} minutes to go before you can ask for another link.",
  },
  "auth.issue.fullNameMissing": "Full name is required.",
  "auth.issue.emailMalformed": "The email address is not valid.",
  "auth.issue.countryUnknown":
    "Country is required and must be a known ISO 3166-1 alpha-2 code.",
  "auth.issue.passwordTooShort": "Password must be at least {min} characters.",
  "auth.issue.passwordTooLong":
    "Password can't be longer than {max} characters (accented letters and emojis count double).",
  "auth.issue.membershipTypeUnknown": "Membership type must be one of {types}.",
  "auth.issue.dateOfBirthNotADate":
    "Date of birth must be a real calendar date written as YYYY-MM-DD.",
  "auth.issue.dateOfBirthInFuture": "Date of birth can't be in the future.",
  "auth.issue.dateOfBirthTooEarly": "Date of birth can't be before {earliest}.",
  "auth.issue.alreadySet":
    "This detail is already on record and can't be changed here.",
  "auth.issue.guardianNameMissing": "Guardian's name is required.",
  "auth.issue.guardianEmailMalformed": "Guardian's email address is not valid.",
  "auth.issue.consentMissing":
    "Tick the consent box: without it the account is not activated.",
  "auth.issue.required": "This detail is required.",
  // El destino va con su propio nombre ("Español", no "Spanish"): quien no
  // entiende el idioma de la pantalla tiene que reconocer el suyo. Y el
  // nombre repite el código que se ve en el botón, para que quien lo maneja
  // con la voz pueda decir "ES" (WCAG 2.5.3).
  "languageToggle.label": "Language: English. Switch to Español (ES)",
  "languageToggle.target": "ES",
} as const satisfies Readonly<Record<string, Message>>;
