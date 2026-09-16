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
  // entiende el idioma de la pantalla tiene que reconocer el suyo. Y el
  // nombre repite el código que se ve en el botón, para que quien lo maneja
  // con la voz pueda decir "ES" (WCAG 2.5.3).
  "languageToggle.label": "Language: English. Switch to Español (ES)",
  "languageToggle.target": "ES",
} as const satisfies Readonly<Record<string, Message>>;
