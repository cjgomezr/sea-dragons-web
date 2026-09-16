import type { MessageCatalog } from "../message";

export const spanishMessages: MessageCatalog = {
  "auth.passwordRecovery.checkEmailTitle": "Revisa tu correo",
  "auth.passwordRecovery.linkSent":
    "Si {email} tiene una cuenta en el club, te mandamos un enlace para elegir una contraseña nueva.",
  "auth.emailRequest.retryAfter": {
    one: "Podrás pedir otro enlace dentro de {count} minuto.",
    other: "Podrás pedir otro enlace dentro de {count} minutos.",
  },
  "languageToggle.label": "Idioma: español. Cambiar a English",
  "languageToggle.target": "EN",
};
