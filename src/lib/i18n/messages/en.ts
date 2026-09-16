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
  // El destino va con su propio nombre ("Español", no "Spanish"): quien no
  // entiende el idioma de la pantalla tiene que reconocer el suyo.
  "languageToggle.label": "Language: English. Switch to Español",
  "languageToggle.target": "ES",
} as const satisfies Readonly<Record<string, Message>>;
