import type { MessageCatalog } from "../message";

export const spanishMessages: MessageCatalog = {
  "auth.passwordRecovery.checkEmailTitle": "Revisa tu correo",
  "auth.passwordRecovery.linkSent":
    "Si {email} tiene una cuenta en el club, te mandamos un enlace para elegir una contraseña nueva.",
  "auth.emailRequest.retryAfter": {
    one: "Podrás pedir otro enlace dentro de {count} minuto.",
    other: "Podrás pedir otro enlace dentro de {count} minutos.",
  },
  "auth.issue.fullNameMissing": "El nombre completo es obligatorio.",
  "auth.issue.emailMalformed": "El correo no tiene una forma válida.",
  "auth.issue.countryUnknown":
    "El país es obligatorio y debe ser un código ISO 3166-1 alfa-2 conocido.",
  "auth.issue.passwordTooShort":
    "La contraseña debe tener al menos {min} caracteres.",
  "auth.issue.passwordTooLong":
    "La contraseña no puede pasar de {max} caracteres (las letras acentuadas y los emojis cuentan doble).",
  "auth.issue.membershipTypeUnknown":
    "El tipo de membresía debe ser uno de {types}.",
  "auth.issue.dateOfBirthNotADate":
    "La fecha de nacimiento debe existir en el calendario y escribirse como AAAA-MM-DD.",
  "auth.issue.dateOfBirthInFuture":
    "La fecha de nacimiento no puede estar en el futuro.",
  "auth.issue.dateOfBirthTooEarly":
    "La fecha de nacimiento no puede ser anterior al {earliest}.",
  "auth.issue.alreadySet":
    "Este dato ya está registrado y no se cambia desde aquí.",
  "auth.issue.guardianNameMissing": "El nombre del tutor es obligatorio.",
  "auth.issue.guardianEmailMalformed":
    "El correo del tutor no tiene una forma válida.",
  "auth.issue.consentMissing":
    "Marca la casilla del consentimiento: sin ella la cuenta no se activa.",
  "auth.issue.required": "Este dato es obligatorio.",
  "languageToggle.label": "Idioma: español. Cambiar a English (EN)",
  "languageToggle.target": "EN",
};
