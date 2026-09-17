import type { MessageCatalog } from "../message";

export const spanishMessages: MessageCatalog = {
  "auth.passwordRecovery.checkEmailTitle": "Revisa tu correo",
  "auth.passwordRecovery.linkSent":
    "Si {email} tiene una cuenta en el club, te mandamos un enlace para elegir una contraseña nueva.",
  "auth.emailRequest.retryAfter": {
    one: "Podrás pedir otro enlace dentro de {count} minuto.",
    other: "Podrás pedir otro enlace dentro de {count} minutos.",
  },
  "auth.brand.eyebrow": "Rugby subacuático · Melbourne",
  "auth.brand.headline": "Tu club, bajo la superficie.",
  "auth.brand.copy":
    "Entrenamientos, equipos, evaluaciones y cuotas. Todo lo que los Seadragons necesitan dentro y fuera del agua.",

  "auth.field.fullName": "Nombre completo",
  "auth.field.email": "Correo electrónico",
  "auth.field.password": "Contraseña",
  "auth.field.country": "País",
  "auth.field.dateOfBirth": "Fecha de nacimiento",
  "auth.field.membershipType": "Tipo de membresía",
  "auth.field.countryPlaceholder": "Selecciona tu país",
  "auth.field.membershipTypePlaceholder": "Selecciona tu membresía",
  "auth.field.passwordHint": "Al menos {min} caracteres.",
  "auth.form.fieldIssues": "Revisa estos campos antes de continuar:",
  "auth.error.network":
    "No pudimos hablar con el servidor. Revisa tu conexión y vuelve a intentarlo.",

  "auth.signIn.metaTitle": "Entrar · Victoria Seadragons",
  "auth.signIn.metaDescription":
    "Entra a la plataforma del club Victoria Seadragons de rugby subacuático.",
  "auth.signIn.title": "Bienvenido de vuelta",
  "auth.signIn.lead": "Entra a tu cuenta de los Seadragons.",
  "auth.signIn.forgotPassword": "¿Olvidaste tu contraseña?",
  "auth.signIn.submit": "Entrar",
  "auth.signIn.firstTime": "¿Primera vez en el club?",
  "auth.signIn.createAccount": "Crear una cuenta",
  "auth.signIn.emptyCredentials":
    "Escribe tu correo y tu contraseña para entrar.",
  "auth.signIn.invalidCredentials": "El correo o la contraseña no coinciden.",
  "auth.signIn.accountUnavailable":
    "Tu cuenta no puede entrar ahora mismo. Escribe al club para que la revisen.",
  "auth.signIn.unexpected":
    "No pudimos entrar. Vuelve a intentarlo en un momento.",

  "auth.registration.metaTitle": "Crear tu cuenta · Victoria Seadragons",
  "auth.registration.metaDescription":
    "Regístrate en la plataforma del club Victoria Seadragons de rugby subacuático.",
  "auth.registration.title": "Crear tu cuenta",
  "auth.registration.lead":
    "Con estos datos el club te da de alta. Te mandaremos un enlace para confirmar tu correo.",
  "auth.registration.submit": "Crear cuenta",
  "auth.registration.rejected":
    "No pudimos crear tu cuenta con estos datos. Revísalos y vuelve a intentarlo.",
  "auth.registration.rateLimited": {
    one: "Se hicieron varios registros seguidos. Espera {count} minuto antes de intentarlo otra vez.",
    other:
      "Se hicieron varios registros seguidos. Espera {count} minutos antes de intentarlo otra vez.",
  },
  "auth.registration.unexpected":
    "No pudimos crear tu cuenta. Vuelve a intentarlo en un momento.",
  "auth.registration.confirmTitle": "Confirma tu correo",
  "auth.registration.emailSent":
    "Te mandamos un enlace a {email}. Ábrelo para terminar: hasta entonces tu cuenta queda incompleta y no puedes entrar.",
  "auth.registration.emailSentNote":
    "Si no te llega en unos minutos, reenvíalo desde aquí.",
  "auth.registration.emailPending":
    "Para terminar tienes que abrir el enlace que mandaremos a {email}. Hasta entonces tu cuenta queda incompleta y no puedes entrar.",
  "auth.registration.emailUnavailable":
    "Ahora no podemos mandar correos, así que el enlace todavía no ha salido. Inténtalo de nuevo más tarde.",
  "auth.registration.previousRegistration":
    "Si esta dirección ya se había registrado antes, siguen valiendo los datos de aquel registro, contraseña incluida: lo que acabas de escribir no los cambia.",
  "auth.registration.resend": "Reenviar el correo",
  "auth.registration.retrySend": "Reintentar el envío",
  "auth.registration.resendStillUnavailable":
    "Lo intentamos de nuevo y todavía no podemos mandar correos.",
  "auth.registration.resendRequested":
    "Si esa dirección tiene una cuenta sin confirmar, el enlace va en camino.",
  "auth.registration.resendNetwork":
    "No pudimos pedir otro correo porque no llegamos al servidor. Revisa tu conexión y vuelve a intentarlo.",
  "auth.registration.resendUnexpected":
    "No pudimos pedir otro correo. Vuelve a intentarlo en un momento.",

  "auth.confirmation.confirmedTitle": "Tu correo quedó confirmado",
  "auth.confirmation.activeBody":
    "Tu cuenta ya está activa. Entra con este correo y tu contraseña.",
  "auth.confirmation.activeNote": "Ya puedes usar la plataforma del club.",
  "auth.confirmation.incompleteBody":
    "Todavía falta algún dato para que tu cuenta pueda operar, así que sigue incompleta.",
  "auth.confirmation.incompleteNote":
    "Entra con este correo y tu contraseña, y te pediremos lo que falta.",
  "auth.confirmation.invalidTitle": "Este enlace ya no sirve",
  "auth.confirmation.invalidBody":
    "El enlace de confirmación caducó o ya se usó. {anotherLinkSteps}",
  "auth.confirmation.errorTitle": "No pudimos confirmar tu correo",
  "auth.confirmation.errorBody":
    "Algo falló de nuestro lado, no en tu enlace. Ese enlace ya se gastó al intentarlo. {anotherLinkSteps}",
  "auth.confirmation.anotherLinkSteps":
    "Para conseguir otro, empieza el registro otra vez con el mismo correo: vuelves a la pantalla de confirmación, y ahí pides uno nuevo con el botón «{resendButton}».",
  "auth.confirmation.contactClub": "Si el problema sigue, escribe al club.",
  "auth.confirmation.backToRegistration": "Volver al registro",

  "auth.completion.metaTitle": "Termina tu registro · Victoria Seadragons",
  "auth.completion.metaDescription":
    "Completa los datos que le faltan a tu cuenta del club Victoria Seadragons.",
  "auth.completion.title": "Termina tu registro",
  "auth.completion.lead":
    "A tu cuenta le falta esto para poder entrar. No te pedimos nada que ya nos hayas dado.",
  "auth.completion.submit": "Guardar y continuar",
  "auth.completion.nothingLeftTitle": "Ya no te falta nada",
  "auth.completion.nothingLeftLead":
    "Tu cuenta está completa. Entra al panel para empezar.",
  "auth.completion.goToDashboard": "Ir al panel",
  "auth.completion.confirmEmailBody":
    "Te mandamos un enlace a {email}. Ábrelo para terminar: hasta entonces tu cuenta sigue incompleta.",
  "auth.completion.resendSent":
    "El enlace va en camino. Revisa también la carpeta de no deseado.",
  "auth.completion.signInRequired":
    "Necesitas iniciar sesión para consultar o completar tu cuenta.",
  "auth.completion.notAMember":
    "Tu sesión no corresponde a ningún socio del club. Escribe al club para que la revisen.",
  "auth.completion.noLongerNeeded":
    "Tu cuenta ya no necesita esto. Recarga la página para ver lo que sigue faltando.",
  "auth.completion.rejected": "Hay datos que no se pueden guardar.",
  "auth.completion.unexpected":
    "No pudimos guardar tus datos. Vuelve a intentarlo en un momento.",

  "auth.guardian.title": "Falta el consentimiento de tu tutor",
  "auth.guardian.body":
    "Eras menor de 18 el día que te registraste. Tu cuenta no se activa hasta que tu madre, padre o tutor dé su consentimiento. Rellenad esto juntos.",
  "auth.guardian.detailIssues": "Revisa estos datos antes de continuar:",
  "auth.guardian.name": "Nombre del tutor",
  "auth.guardian.email": "Correo del tutor",
  "auth.guardian.consent":
    "Soy su madre, padre o tutor legal y doy mi consentimiento para que el club Victoria Seadragons trate los datos de esta cuenta.",
  "auth.guardian.submit": "Registrar el consentimiento",

  "auth.passwordRecovery.metaTitle":
    "Recuperar tu contraseña · Victoria Seadragons",
  "auth.passwordRecovery.metaDescription":
    "Pide un enlace para elegir una contraseña nueva en la plataforma del club Victoria Seadragons.",
  "auth.passwordRecovery.title": "Recuperar tu contraseña",
  "auth.passwordRecovery.lead":
    "Escribe el correo de tu cuenta y te mandaremos un enlace para elegir una contraseña nueva.",
  "auth.passwordRecovery.submit": "Enviar enlace",
  "auth.passwordRecovery.linkNote":
    "El enlace caduca a los {minutes} minutos y sirve una sola vez. Si no llega, revisa la carpeta de spam o vuelve a pedirlo.",
  "auth.passwordRecovery.backToSignIn": "Volver a entrar",
  "auth.passwordRecovery.emptyEmail":
    "Escribe el correo de tu cuenta para pedir el enlace.",
  "auth.passwordRecovery.rateLimited": {
    one: "Pediste varios enlaces seguidos. Espera {count} minuto antes de pedir otro.",
    other:
      "Pediste varios enlaces seguidos. Espera {count} minutos antes de pedir otro.",
  },
  "auth.passwordRecovery.emailUnavailable":
    "El envío de correos no está disponible ahora mismo, así que no podemos mandarte el enlace. Si necesitas entrar ya, escribe al club.",
  "auth.passwordRecovery.unexpected":
    "No pudimos pedir el enlace. Vuelve a intentarlo en un momento.",

  "auth.newPassword.metaTitle":
    "Elige tu contraseña nueva · Victoria Seadragons",
  "auth.newPassword.metaDescription":
    "Elige una contraseña nueva para tu cuenta del club Victoria Seadragons.",
  "auth.newPassword.title": "Elige tu contraseña nueva",
  "auth.newPassword.lead":
    "Es la que usarás a partir de ahora para entrar al club.",
  "auth.newPassword.label": "Contraseña nueva",
  "auth.newPassword.submit": "Guardar contraseña",
  "auth.newPassword.unexpected":
    "No pudimos cambiar tu contraseña. Vuelve a intentarlo en un momento.",
  "auth.newPassword.linkUnusableTitle": "Este enlace ya no sirve",
  "auth.newPassword.linkUnusableBody":
    "El enlace para cambiar tu contraseña caducó o ya se usó. Cada enlace dura {minutes} minutos y sirve una sola vez.",
  "auth.newPassword.passwordRejected":
    "No pudimos usar esa contraseña: es igual a la anterior o demasiado débil. El enlace ya se usó al intentarlo, así que pide otro enlace y elige una distinta.",
  "auth.newPassword.requestAnotherLink": "Pedir otro enlace",
  "auth.newPassword.changedTitle": "Tu contraseña quedó cambiada",
  "auth.newPassword.changedLead": "Ya puedes entrar con tu contraseña nueva.",

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
  "nav.sidebarLabel": "Principal",
  "nav.tabBarLabel": "Secciones",
  "nav.more": "Más",
  "nav.label.dashboard": "Dashboard",
  "nav.label.directory": "Directorio",
  "nav.label.calendar": "Calendario",
  "nav.label.teams": "Equipos",
  "nav.label.evaluations": "Evaluaciones",
  "nav.label.news": "Noticias",
  "nav.label.payments": "Pagos",
  "nav.label.dashboardShort": "Inicio",
  // "Calendario" ocupaba el 89% de su pestaña a 360px y se partía con las
  // fuentes de Linux. Ojo para E7: el prototipo llama "Agenda" a una de las
  // vistas del calendario (Mes/Semana/Agenda). Si esa vista se implementa,
  // conviene renombrarla para no tener una pestaña y una vista con el mismo
  // nombre.
  "nav.label.calendarShort": "Agenda",
  "app.metaDescription":
    "Plataforma del club de rugby subacuático Victoria Seadragons (Melbourne).",
  "section.underConstruction": "Esta sección está en construcción.",
  "home.lead":
    "Plataforma del club de rugby subacuático. Esta es la cáscara inicial: el resto de las funcionalidades llega epic por epic, cada una con sus tickets y su revisión.",
  "home.status.title": "Estado del servicio",
  "home.status.body":
    "La API versionada responde en el endpoint de salud, que consulta la base de datos.",
  "signOut.label": "Cerrar sesión",
  "themeToggle.switchToLight": "Cambiar a tema claro",
  "themeToggle.switchToDark": "Cambiar a tema oscuro",
  "languageToggle.label": "Idioma: español. Cambiar a English (EN)",
  "languageToggle.target": "EN",
};
