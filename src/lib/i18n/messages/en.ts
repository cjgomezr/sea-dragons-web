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
} as const satisfies Readonly<Record<string, Message>>;
