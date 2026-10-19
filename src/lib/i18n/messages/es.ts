import type { MessageCatalog } from "../message";

export const spanishMessages: MessageCatalog = {
  "auth.passwordRecovery.checkEmailTitle": "Revisa tu correo",
  "auth.passwordRecovery.linkSent":
    "Si {email} tiene una cuenta en el club, te mandamos un enlace para elegir una contraseña nueva.",
  "auth.emailRequest.retryAfter": {
    one: "Podrás pedir otro enlace dentro de {count} minuto.",
    other: "Podrás pedir otro enlace dentro de {count} minutos.",
  },
  "auth.brand.signInLink": "{club}: inicio de sesión",
  "auth.brand.eyebrow": "Rugby subacuático · Melbourne",
  "auth.brand.headline": "Tu club, bajo la superficie.",
  "auth.brand.copy":
    "Entrenamientos, equipos, evaluaciones y cuotas. Todo lo que los Seadragons necesitan dentro y fuera del agua.",

  "auth.field.fullName": "Nombre completo",
  "auth.field.email": "Correo electrónico",
  "auth.field.password": "Contraseña",
  "auth.field.country": "País",
  "auth.field.dateOfBirth": "Fecha de nacimiento",
  "auth.field.countryPlaceholder": "Selecciona tu país",
  "auth.field.passwordHint": "Al menos {min} caracteres.",
  "auth.form.fieldIssues": "Revisa estos campos antes de continuar:",
  "auth.error.network":
    "No pudimos hablar con el servidor. Revisa tu conexión y vuelve a intentarlo.",

  "auth.signIn.metaTitle": "Entrar · {club}",
  "auth.signIn.metaDescription":
    "Entra a la plataforma del club {club} de rugby subacuático.",
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

  "auth.registration.metaTitle": "Crear tu cuenta · {club}",
  "auth.registration.metaDescription":
    "Regístrate en la plataforma del club {club} de rugby subacuático.",
  "auth.registration.title": "Crear tu cuenta",
  "auth.registration.lead":
    "Con estos datos el club te da de alta. Te mandaremos un enlace para confirmar tu correo.",
  "auth.registration.submit": "Crear cuenta",
  "auth.registration.haveAccount": "¿Ya tienes cuenta?",
  "auth.registration.signIn": "Inicia sesión",
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

  "auth.confirmEmail.metaTitle": "Confirma tu correo · {club}",
  "auth.confirmEmail.metaDescription":
    "Confirma la dirección de correo de tu cuenta del club {club}.",
  "auth.confirmEmail.title": "Confirma tu correo",
  "auth.confirmEmail.lead":
    "Pulsa el botón para terminar de confirmar tu dirección de correo.",
  "auth.confirmEmail.submit": "Confirmar mi correo",

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

  "auth.completion.metaTitle": "Termina tu registro · {club}",
  "auth.completion.metaDescription":
    "Completa los datos que le faltan a tu cuenta del club {club}.",
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
    "Tu sesión no corresponde a ningún miembro del club. Escribe al club para que la revisen.",
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
    "Soy su madre, padre o tutor legal y doy mi consentimiento para que el club {club} trate los datos de esta cuenta.",
  "auth.guardian.submit": "Registrar el consentimiento",

  "auth.passwordRecovery.metaTitle": "Recuperar tu contraseña · {club}",
  "auth.passwordRecovery.metaDescription":
    "Pide un enlace para elegir una contraseña nueva en la plataforma del club {club}.",
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

  "auth.newPassword.metaTitle": "Elige tu contraseña nueva · {club}",
  "auth.newPassword.metaDescription":
    "Elige una contraseña nueva para tu cuenta del club {club}.",
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
  "nav.label.attendance": "Asistencia",
  "nav.label.teams": "Equipos",
  "nav.label.evaluations": "Evaluaciones",
  "nav.label.news": "Noticias",
  "nav.label.payments": "Pagos",
  "nav.label.groups": "Grupos",
  "nav.label.dashboardShort": "Inicio",
  // "Calendario" ocupaba el 89% de su pestaña a 360px y se partía con las
  // fuentes de Linux. Ojo para E7: el prototipo llama "Agenda" a una de las
  // vistas del calendario (Mes/Semana/Agenda). Si esa vista se implementa,
  // conviene renombrarla para no tener una pestaña y una vista con el mismo
  // nombre.
  "nav.label.calendarShort": "Agenda",
  // Directorio sólo es pestaña fija para los roles que no ven Equipos (#213).
  // Ni "Directorio" ni "Miembros" caben a 360px: el segundo llegó al 92% de
  // su pestaña con las fuentes de Linux y el guardián de geometría corta en
  // el 85% (#246). "Gente" es lo que dice el inglés ("People") y deja sitio.
  "nav.label.directoryShort": "Gente",
  "app.metaDescription":
    "Plataforma del club de rugby subacuático {club} (Melbourne).",
  "section.loading": "Cargando",
  "dashboard.eyebrow": "Inicio",
  "dashboard.greeting.morning": "Buenos días, {name}",
  "dashboard.greeting.afternoon": "Buenas tardes, {name}",
  "dashboard.greeting.evening": "Buenas noches, {name}",
  "dashboard.newTraining": "Nuevo entrenamiento",
  "dashboard.loading": "Cargando…",
  "dashboard.retry": "Volver a intentarlo",
  "dashboard.error.unexpected":
    "No pudimos cargar el inicio. Vuelve a intentarlo.",
  "dashboard.error.signInRequired":
    "Tu sesión terminó. Vuelve a entrar para ver el inicio.",
  "dashboard.unavailable": "No disponible",
  "dashboard.tiles.label": "El club de un vistazo",
  "dashboard.tile.accessibleName": "{label}: {value}",
  "dashboard.tile.noData": "Sin datos",
  "dashboard.tile.attendance": "Asistencia",
  "dashboard.tile.clubRate": "Tasa de asistencia",
  "dashboard.tile.clubRate.caption": "últimos 30 días",
  "dashboard.tile.ownAttendance": "Tu asistencia",
  "dashboard.tile.ownAttendance.caption": {
    one: "{count} sesión",
    other: "{count} sesiones",
  },
  "dashboard.tile.members": "Miembros activos",
  "dashboard.tile.members.caption": "+{count} este mes",
  "dashboard.tile.nextTraining": "Próximo entrenamiento",
  "dashboard.tile.nextTraining.today": "hoy {time}",
  "dashboard.tile.nextTraining.hours": "{count} h",
  "dashboard.tile.nextTraining.days": "{count} d",
  "dashboard.tile.nextTraining.caption": "{day} · {location}",
  "dashboard.tile.nextTraining.none": "Sin entrenamiento programado",
  "dashboard.tile.unreadNews": "Noticias sin leer",
  "dashboard.tile.unreadNews.caption": {
    one: "{count} anuncio",
    other: "{count} anuncios",
  },
  "dashboard.tile.unreadNews.none": "Al día",
  "dashboard.upcoming.title": "Próximos",
  "dashboard.upcoming.all": "Calendario",
  "dashboard.upcoming.empty": "No hay eventos próximos.",
  "dashboard.news.title": "Últimas noticias",
  "dashboard.news.all": "Todas",
  "dashboard.news.empty": "Todavía no hay noticias.",
  "signOut.label": "Cerrar sesión",
  "account.link": "Mi cuenta",
  "accountMenu.profile": "Mi perfil",
  "accountMenu.appearance": "Apariencia",
  "accountMenu.language": "Idioma",
  "accountMenu.back": "Volver",
  "accountMenu.clubSettings": "Configuración del club",
  "accountMenu.title": "Cuenta",
  "accountMenu.youAreHere": "Estás aquí",
  "accountMenu.themeLight": "Claro",
  "accountMenu.themeDark": "Oscuro",
  "accountMenu.themeSystem": "Sistema",
  "account.metaTitle": "Perfil · {club}",
  "account.metaDescription":
    "Tus datos, tu rol en el club y tus grupos, y la solicitud para ser Coach o entrar al Comité.",
  "role.Admin": "Admin",
  "role.Coach": "Coach",
  "role.Committee": "Comité",
  "role.Player": "Jugador",
  "account.request.title": "Pedir un rol",
  "account.request.body":
    "Un Admin revisa cada solicitud. Conservas tu rol actual hasta que la apruebe.",
  "account.request.roleLegend": "Rol que pides",
  "account.request.justification": "¿Por qué quieres este rol? (opcional)",
  "account.request.characterCount": "{used}/{max}",
  "account.request.justificationTooLong":
    "La nota puede tener como mucho {max} caracteres. Acórtala para enviar la solicitud.",
  "account.request.roleMissing": "Elige el rol que quieres pedir.",
  "account.request.submit": "Enviar solicitud",
  "account.request.sending": "Enviando…",
  "account.pending.title": "Solicitud pendiente",
  "account.pending.body":
    "Pediste ser {role} el {date}. Todavía no hay respuesta de un Admin.",
  "account.adminNote":
    "Como Admin ya tienes todas las capacidades, así que no hay ningún rol que pedir.",
  // Mis grupos (#229). Sólo los grupos propios, sin sus demás miembros.
  "account.groups.title": "Mis grupos",
  "account.groups.empty": "Todavía no perteneces a ningún grupo.",
  "account.evaluation.title": "Evaluación",
  "account.evaluation.staffOnly":
    "Las notas de las evaluaciones solo las ve el personal de entrenamiento.",
  "account.error.pending":
    "Ya tienes una solicitud esperando respuesta. Recarga la página para verla.",
  "account.error.roleAlreadyHeld": "Ya tienes ese rol.",
  "account.error.signInRequired":
    "Tu sesión terminó. Vuelve a entrar para enviar la solicitud.",
  "account.error.forbidden": "Tu cuenta no puede pedir un rol ahora mismo.",
  "account.error.unexpected":
    "No pudimos enviar la solicitud. Vuelve a intentarlo en un momento.",
  // El perfil propio (#241).
  "account.profile.title": "Tus datos",
  "account.profile.fullName": "Nombre completo",
  "account.profile.country": "País",
  "account.profile.position": "Posición",
  "account.profile.positionRetired": "{name} (retirada)",
  "account.profile.experienceLevel": "Nivel de experiencia",
  "account.profile.gender": "Género",
  "account.profile.notSet": "Sin indicar",
  "account.profile.save": "Guardar cambios",
  "account.profile.saving": "Guardando…",
  "account.profile.saved": "Cambios guardados.",
  "account.profile.issue.fullNameMissing": "Escribe tu nombre.",
  "account.profile.issue.fullNameTooLong":
    "El nombre puede tener como mucho {max} caracteres.",
  "account.profile.issue.countryUnknown": "Elige tu país de la lista.",
  "account.profile.issue.positionUnknown": "Elige una posición de la lista.",
  "account.profile.issue.experienceLevelUnknown":
    "Elige un nivel de experiencia de la lista.",
  "account.profile.issue.genderUnknown": "Elige un género de la lista.",
  "account.profile.error.network":
    "No pudimos guardar tus cambios. Revisa tu conexión y vuelve a intentarlo.",
  "account.profile.error.signInRequired":
    "Tu sesión terminó. Vuelve a entrar para guardar tus cambios.",
  "account.profile.error.forbidden":
    "Tu cuenta no puede cambiar estos datos ahora mismo.",
  "account.profile.error.unexpected":
    "No pudimos guardar tus cambios. Vuelve a intentarlo en un momento.",
  // El AUF del perfil propio (#274): lo escribe el miembro y queda pendiente
  // hasta que un Admin lo verifica.
  "account.profile.auf.title": "Registro AUF",
  "account.profile.auf.number": "Número de AUF",
  "account.profile.auf.expiry": "Vencimiento del AUF",
  "account.profile.auf.hint":
    "Un Admin lo revisa antes de darlo por verificado.",
  "account.profile.auf.pending": "Pendiente de que un Admin lo verifique.",
  "account.profile.auf.verified":
    "Verificado por un Admin. Sólo un Admin puede cambiarlo.",
  "account.profile.auf.summary": "AUF {number} · vence el {date}",
  "account.profile.auf.withoutExpiry": "AUF {number} · sin vencimiento",
  "account.profile.issue.aufNumberMissing": "Escribe tu número de AUF.",
  "account.profile.issue.aufNumberTooLong":
    "Tu número de AUF no puede pasar de {max} caracteres.",
  "account.profile.issue.aufExpiryNotADate":
    "Escribe una fecha de vencimiento válida.",
  "account.profile.issue.aufExpiryBeforeJoined":
    "El vencimiento no puede ser anterior al día en que ingresaste al club.",
  "account.profile.error.aufVerified":
    "Tu AUF ya está verificado. Sólo un Admin puede cambiarlo.",
  // El aviso de los datos de contacto que faltan (#498).
  "contactReminder.emergencyContact.title": "Añade tu contacto de emergencia",
  "contactReminder.phone.title": "Añade tu teléfono",
  "contactReminder.both.title": "Añade tu teléfono y tu contacto de emergencia",
  "contactReminder.emergencyContact.why":
    "Para que el club sepa a quién llamar si te pasa algo en la piscina.",
  "contactReminder.phone.why":
    "Para que el club pueda localizarte si hace falta.",
  "contactReminder.link": "Complétalo en Contacto, en tu perfil",
  "contactReminder.dismissPhone": "Cerrar el aviso del teléfono",
  // El teléfono y el contacto de emergencia del perfil propio (#496).
  "account.profile.contact.title": "Contacto",
  "account.profile.contact.phone": "Tu teléfono (opcional)",
  "account.profile.contact.emergencyLegend": "Contacto de emergencia",
  "account.profile.contact.emergencyHint":
    "A quién llamamos si te pasa algo en el agua. Rellena los tres datos o déjalos vacíos.",
  "account.profile.contact.emergencyName": "Nombre del contacto",
  "account.profile.contact.emergencyPhone": "Teléfono del contacto",
  "account.profile.contact.emergencyRelationship": "Relación",
  "account.profile.contact.samePhone":
    "Es tu propio teléfono. El contacto de emergencia debería ser otra persona.",
  "account.profile.contact.guardianRelationship": "Tutor",
  "account.profile.contact.guardianProposed":
    "Te proponemos a tu tutor. Escribe su teléfono para guardarlo.",
  "account.profile.issue.phoneInvalidCharacters":
    "Usa sólo dígitos, espacios, guiones, paréntesis y un + al principio.",
  "account.profile.issue.phoneTooShort":
    "Un teléfono necesita al menos {min} dígitos.",
  "account.profile.issue.phoneTooLong":
    "Un teléfono puede tener como mucho {max} dígitos.",
  "account.profile.issue.emergencyNameMissing":
    "Escribe el nombre del contacto o deja los tres datos vacíos.",
  "account.profile.issue.emergencyPhoneMissing":
    "Escribe el teléfono del contacto o deja los tres datos vacíos.",
  "account.profile.issue.emergencyRelationshipMissing":
    "Escribe tu relación con esa persona o deja los tres datos vacíos.",
  "account.profile.issue.emergencyTextTooLong":
    "Puede tener como mucho {max} caracteres.",
  // La foto de perfil (#245): el círculo de la cabecera y sus controles.
  "account.photo.alt": "Tu foto de perfil",
  "account.photo.add": "Añadir foto",
  "account.photo.change": "Cambiar foto",
  "account.photo.remove": "Quitar foto",
  "account.photo.choose": "Elegir una foto",
  "account.photo.hint": "JPEG, PNG o WebP, hasta {max} MB.",
  "account.photo.uploading": "Subiendo…",
  "account.photo.removing": "Quitando…",
  "account.photo.saved": "Foto actualizada.",
  "account.photo.removed": "Foto quitada.",
  "account.photo.retry": "Reintentar",
  "profileHero.auf.pending": "AUF pendiente",
  "profileHero.memberSince": "Miembro desde {date}",
  "profileCompletion.title": "Tu perfil está casi completo. Falta:",
  "profileCompletion.progress": "Perfil completado",
  "profileCompletion.item.emergency_contact": "Contacto de emergencia",
  "profileCompletion.item.phone": "Teléfono",
  "profileCompletion.item.country": "País",
  "account.photo.issue.photoTooLarge":
    "Esta foto pesa más de {max} MB. Elige una más pequeña.",
  "account.photo.issue.photoTypeUnsupported":
    "Sólo valen fotos JPEG, PNG o WebP.",
  "account.photo.issue.photoEmpty": "Este archivo está vacío. Elige otra foto.",
  "account.photo.error.network":
    "No pudimos conectar con el servidor. Tu foto no ha cambiado. Revisa la conexión y vuelve a intentarlo.",
  "account.photo.error.signInRequired":
    "Tu sesión terminó. Vuelve a entrar para cambiar tu foto.",
  "account.photo.error.forbidden":
    "Tu cuenta no puede cambiar su foto ahora mismo.",
  "account.photo.error.unexpected":
    "Algo falló y tu foto no ha cambiado. Vuelve a intentarlo en un momento.",
  "level.Beginner": "Principiante",
  "level.Intermediate": "Intermedio",
  "level.Advanced": "Avanzado",
  "gender.female": "Mujer",
  "gender.male": "Hombre",
  "gender.non_binary": "No binario",
  "gender.undisclosed": "Prefiero no decirlo",

  "admin.loading": "Cargando las solicitudes pendientes…",
  "admin.loadFailed": "No pudimos cargar las solicitudes pendientes.",
  "admin.retry": "Volver a intentar",
  "admin.requests.empty": "No hay solicitudes esperando respuesta.",
  "admin.requests.noJustification": "No escribió ninguna nota.",
  "admin.requests.approve": "Aprobar",
  "admin.requests.reject": "Rechazar",
  "admin.requests.approveLabel": "Aprobar la solicitud de {name}",
  "admin.requests.rejectLabel": "Rechazar la solicitud de {name}",
  "admin.requests.approved": "{name} ahora es {role}.",
  "admin.requests.rejected": "Se rechazó la solicitud de {name}.",
  "admin.members.roleLabel": "Rol de {name}",
  "admin.members.save": "Guardar",
  "admin.members.saveLabel": "Guardar el rol de {name}",
  "admin.members.saving": "Guardando…",
  "admin.members.saved": "{name} ya es {role}.",
  "admin.error.alreadyDecided": "Otro Admin ya respondió esta solicitud.",
  "admin.error.lastAdmin":
    "Es el último Admin del club. Nombra a otro Admin antes de cambiar este rol.",
  "admin.error.roleAlreadyGranted":
    "Ese miembro ya tiene ese rol o uno mayor. Rechaza la solicitud.",
  "admin.error.gone": "Esa solicitud ya no está en el club.",
  "admin.error.memberGone": "Ese miembro ya no está en el club.",
  "admin.error.signInRequired":
    "Tu sesión terminó. Vuelve a entrar para seguir.",
  "admin.error.forbidden": "Tu rol no puede gestionar miembros ni roles.",
  "admin.error.unexpected":
    "No pudimos completar la acción. Vuelve a intentarlo en un momento.",
  // La sección Grupos (#228, RF-2 a RF-7 del PRD de E4).
  "groups.metaTitle": "Grupos · {club}",
  "groups.metaDescription":
    "Crea los grupos del club y elige qué miembros pertenecen a cada uno.",
  "groups.title": "Grupos",
  "groups.lead":
    "Los grupos juntan miembros para poder dirigirles un entrenamiento, un evento o una noticia.",
  "groups.loading": "Cargando los grupos del club…",
  "groups.loadFailed": "No pudimos cargar los grupos del club.",
  "groups.retry": "Volver a intentarlo",
  "groups.list.title": "Grupos del club",
  "groups.list.empty":
    "Este club todavía no tiene grupos. Crea el primero para empezar a juntar miembros.",
  "groups.memberCount": {
    one: "{count} miembro",
    other: "{count} miembros",
  },
  "groups.create.label": "Nombre del grupo nuevo",
  "groups.create.submit": "Crear grupo",
  "groups.create.saving": "Creando…",
  "groups.rename": "Renombrar",
  "groups.renameLabel": "Renombrar {name}",
  "groups.renameField": "Nombre nuevo de {name}",
  "groups.renameSubmit": "Guardar el nombre nuevo",
  "groups.renameSaving": "Guardando…",
  "groups.cancel": "Cancelar",
  "groups.delete": "Borrar",
  "groups.deleteLabel": "Borrar {name}",
  "groups.deleteQuestion": {
    one: "¿Borrar «{name}»? Tiene {count} miembro, que sigue en el club.",
    other: "¿Borrar «{name}»? Tiene {count} miembros, que siguen en el club.",
  },
  "groups.deleteSubmit": "Borrar el grupo",
  "groups.deleting": "Borrando…",
  "groups.members.title": "Miembros de {name}",
  "groups.members.loading": "Cargando los miembros del grupo…",
  "groups.members.loadFailed": "No pudimos cargar los miembros de este grupo.",
  "groups.members.empty":
    "Este grupo todavía no tiene miembros. Agrega el primero desde la lista.",
  "groups.members.close": "Cerrar el grupo",
  "groups.members.remove": "Quitar",
  "groups.members.pendingActivation": "Pendiente de activar",
  "groups.members.removeLabel": "Quitar a {name} del grupo",
  "groups.members.removing": "Quitando…",
  "groups.members.addLabel": "Miembro para agregar",
  "groups.members.add": "Agregar al grupo",
  "groups.members.adding": "Agregando…",
  "groups.members.noCandidates":
    "Todos los miembros del club ya están en este grupo.",
  "groups.error.nameTaken": "El club ya tiene un grupo con ese nombre.",
  "groups.error.invalidName":
    "El nombre tiene que tener entre 1 y {max} caracteres.",
  "groups.error.groupGone": "Ese grupo ya no está en el club.",
  "groups.error.memberInactive":
    "Ese miembro tiene la cuenta desactivada, así que no se puede agregar.",
  "groups.error.signInRequired":
    "Tu sesión terminó. Vuelve a entrar para seguir.",
  "groups.error.forbidden": "Tu rol no puede gestionar los grupos del club.",
  "groups.error.unexpected":
    "No pudimos completar la acción. Vuelve a intentarlo en un momento.",

  // El directorio del club (#239). Las posiciones van en femenino de lugar
  // ("Portería", "Ataque") y no de persona ("Portero"): nombran el puesto, y
  // así la fila no le asigna un género a nadie.
  "directory.metaTitle": "Directorio · {club}",
  "directory.metaDescription":
    "Todo el club, con su país, su nivel, su rol y su posición.",
  "directory.title": "Directorio",
  "directory.loading": "Cargando el directorio del club…",
  "directory.retry": "Volver a intentarlo",
  "directory.list.title": "Miembros del club",
  "directory.memberCount": {
    one: "{count} miembro",
    other: "{count} miembros",
  },
  "directory.search.label": "Buscar por nombre",
  "directory.search.placeholder": "Busca a alguien del club…",
  "directory.role.legend": "Filtrar por rol",
  "directory.role.all": "Todos",
  "directory.includeInactive": "Incluir las cuentas desactivadas",
  "directory.empty": "Nadie del club coincide con lo que buscas.",
  "directory.clearFilters": "Borrar filtros",
  "directory.empty.title": "Ningún miembro coincide con estos filtros",
  "directory.empty.criteria":
    "Mostrando {criteria}. Prueba a quitar un filtro.",
  "directory.empty.allRoles": "todos los roles",
  "directory.empty.name": "Nombre",
  "directory.filter.legend": "Más filtros",
  "directory.filter.position": "Posición",
  "directory.filter.position.all": "Todas las posiciones",
  "directory.filter.position.none": "Sin posición",
  "directory.filter.group": "Grupo",
  "directory.filter.group.all": "Todos los grupos",
  "directory.filter.auf": "AUF",
  "directory.filter.auf.all": "Cualquier AUF",
  "directory.filter.auf.missing": "Sin número de AUF",
  "directory.filter.auf.expired": "Vencido",
  "directory.filter.auf.expiring": "Vence en los próximos 30 días",
  "directory.filter.auf.unverified": "Sin verificar",
  "directory.filter.auf.renewal": "Vencido o por vencer",
  "directory.filter.membership": "Membresía",
  "directory.filter.membership.all": "Cualquier membresía",
  "directory.filter.membership.pending": "Pendiente",
  "directory.filter.membership.trialing": "En prueba",
  "directory.filter.membership.active": "Activa",
  "directory.filter.membership.pastDue": "Pago fallido",
  "directory.filter.membership.cancelled": "Cancelada",
  "directory.filter.membership.waived": "Exenta",
  "directory.filter.membership.none": "Sin membresía",
  // Los filtros de contacto (#499), de quien ve todo el contacto.
  "directory.filter.withoutPhone": "Sin teléfono",
  "directory.filter.withoutEmergencyContact": "Sin contacto de emergencia",
  "directory.filter.toggle": "Filtros",
  "directory.filter.toggleActive": {
    one: "Filtros: {count} activo",
    other: "Filtros: {count} activos",
  },
  "directory.filter.sheetTitle": "Filtros",
  "directory.filter.apply": "Ver resultados",
  "directory.filter.clearAll": "Borrar todo",
  "directory.filter.showMembers": {
    one: "Mostrar {count} miembro",
    other: "Mostrar {count} miembros",
  },
  "directory.filter.chips": "Filtros activos",
  "directory.filter.chip": "{filter}: {value}",
  "directory.filter.chipRemove": "Quitar el filtro {filter}",
  "directory.filter.chipsClear": "Borrar",
  "directory.count": {
    one: "{shown} de {count} miembro",
    other: "{shown} de {count} miembros",
  },
  "directory.requests.none": "No hay solicitudes pendientes",
  "directory.requests.waiting": {
    one: "{count} solicitud de rol esperando",
    other: "{count} solicitudes de rol esperando",
  },
  "directory.error.filterForbidden":
    "Tu rol no puede usar alguno de estos filtros. Vuelve a intentarlo sin ellos.",
  "directory.column.member": "Miembro",
  "directory.column.role": "Rol",
  "directory.column.position": "Posición",
  "directory.column.attendance": "Asistencia",
  "directory.column.attendanceShort": "Asist.",
  // El contacto de cada socio (#499), según quién mira.
  "directory.contact.email": "Correo",
  "directory.contact.phone": "Teléfono",
  "directory.contact.emergencyPerson": "{name} ({relationship})",
  // El porcentaje de asistencia de un miembro (#396): en el directorio, el
  // perfil propio y la ficha. El prefijo sólo lo oye un lector de pantalla.
  "memberAttendance.title": "Asistencia",
  "memberAttendance.noData": "Sin datos",
  "memberAttendance.spokenPrefix": "Asistencia: ",
  "memberAttendance.sessions": {
    one: "{count} sesión",
    other: "{count} sesiones",
  },
  "directory.field.country": "País",
  "directory.field.level": "Nivel",
  "directory.sort.label": "Ordenar por",
  "directory.sort.direction.asc": "Ascendente",
  "directory.sort.direction.desc": "Descendente",
  // El directorio en el móvil (#553): el botón del orden, su hoja, el menú
  // "⋯", el aviso de solicitudes y su pantalla.
  "directory.sort.open": "Orden: {field}",
  "directory.sort.openLabel": "Orden: {field}, {direction}",
  "directory.sort.activeOption": "{field}, {direction}",
  "directory.sort.spoken.asc": "ascendente",
  "directory.sort.spoken.desc": "descendente",
  "directory.sort.field.name": "Nombre",
  "directory.sort.hint":
    "Toca otra vez la opción activa para invertir el orden.",
  "directory.more.open": "Más acciones",
  "directory.more.title": {
    one: "{count} miembro en esta vista",
    other: "{count} miembros en esta vista",
  },
  "directory.more.email": "Escribir a estos miembros",
  "directory.more.emailHint": "Cada uno recibe su copia · {quota} al día",
  "directory.more.exportHint": "Solo las columnas que tu rol puede ver",
  "directory.more.cancel": "Cancelar",
  "directory.requests.review": "Revisar",
  "directory.requestsScreen.title": "Solicitudes de rol",
  "directory.requestsScreen.back": "Volver al directorio",
  "directory.requestsScreen.change": "De {from} a {to}",
  "directory.requestsScreen.reason": "Motivo",
  "directory.requestsScreen.allCaughtUp": "Todo al día",
  "directory.mark.inactive": "Desactivada",
  "directory.dot.aufExpired": "AUF vencido",
  "directory.dot.membershipPastDue": "Membresía vencida",
  "directory.dot.aufMissing": "Sin número de AUF",
  "directory.dot.aufExpiring": "AUF por vencer",
  "directory.legend.label": "Puntos de estado",
  "directory.legend.danger": "Necesita acción",
  "directory.legend.warning": "Revisar pronto",
  "directory.invited.pill": "Invitado",
  "directory.invited.line": "Invitado el {date} · todavía no ha entrado",
  "directory.request.pill": "→ {role}",
  "directory.request.label": "Pidió ser {role}",
  // El panel lateral y la ficha rápida del socio (#550, RF-5 del PRD de E21).
  "directory.panel.toggle": "Panel lateral",
  "directory.panel.label": "Panel lateral",
  "directory.panel.memberLabel": "Ficha de {name}",
  "directory.panel.close": "Cerrar el panel",
  // El resumen del club en el panel del Admin (#551, RF-4 del PRD de E21).
  "directory.panel.toggleWaiting": {
    one: "Panel lateral, {count} solicitud pendiente",
    other: "Panel lateral, {count} solicitudes pendientes",
  },
  "directory.overview.title": "Resumen del club",
  "directory.overview.subtitle":
    "Selecciona a un miembro para ver sus datos o cambiarle el rol.",
  "directory.overview.requests": "Solicitudes de rol · {count}",
  "directory.overview.requestLabel": "Solicitud de rol de {name}",
  "directory.overview.openMember": "Abrir la ficha de {name}",
  "directory.overview.aufTitle": {
    one: "{count} registro AUF por renovar",
    other: "{count} registros AUF por renovar",
  },
  "directory.overview.aufExpired": "{name} (vencido)",
  "directory.overview.aufExpiring": "{name} (por vencer)",
  "directory.overview.view": "Ver",
  "directory.overview.viewLabel": "Ver los AUF por renovar",
  "directory.overview.attention": "Necesita atención",
  "directory.overview.attention.aufMissing": "Sin AUF",
  "directory.overview.attention.aufRenewal": "AUF vencido o por vencer",
  "directory.overview.attention.withoutEmergencyContact":
    "Sin contacto de emergencia",
  "directory.overview.attention.membershipPastDue": "Membresía vencida",
  "directory.card.tags": "Etiquetas",
  "directory.card.facts": "Datos",
  "directory.card.role": "Rol",
  "directory.card.roleChange": "{from} → {to}",
  "directory.card.cancel": "Cancelar",
  "directory.card.saveRole": "Guardar rol",
  "directory.card.savingRole": "Guardando…",
  "directory.card.roleSaved": "Rol guardado",
  "directory.card.contact": "Contacto",
  "directory.card.copyEmail": "Copiar el correo",
  "directory.card.copyPhone": "Copiar el teléfono",
  "directory.card.copyEmergency": "Copiar el contacto de emergencia",
  "directory.card.copiedEmail": "Correo copiado.",
  "directory.card.copiedPhone": "Teléfono copiado.",
  "directory.card.copiedEmergency": "Contacto de emergencia copiado.",
  "directory.card.copyFailed":
    "El navegador no pudo copiarlo. Selecciona el texto y cópialo a mano.",
  "directory.card.noPhone": "Sin teléfono",
  "directory.card.noEmergency": "Sin contacto de emergencia",
  "directory.card.add": "Añadir",
  "directory.card.addPhoneLabel": "Añadir el teléfono de {name}",
  "directory.card.addEmergencyLabel":
    "Añadir el contacto de emergencia de {name}",
  "directory.card.emergencyLine": "{person} · {phone}",
  "directory.card.aufLine": "{number} · {date}",
  "directory.card.openRecord": "Abrir ficha completa",
  "directory.card.invitation":
    "Invitación enviada el {date} · todavía sin aceptar",
  "directory.card.invitationResent": "Enviada otra vez a {email}",
  "directory.card.request": "Solicitud de rol",
  "directory.card.requestAsked": "Pidió ser",
  "directory.card.justification": "«{text}»",
  "directory.sheet.close": "Cerrar la ficha",
  "directory.action.group": "Acciones de {name}",
  "directory.action.email": "Escribir a {name}",
  "directory.action.call": "Llamar a {name}",
  "directory.action.emergency": "Llamar al contacto de emergencia de {name}",
  "directory.action.noPhone": "{name} no tiene teléfono",
  "directory.action.noEmergency": "{name} no tiene contacto de emergencia",
  "directory.mark.aufExpired": "AUF vencido",
  // #274: el AUF que escribió el miembro, hasta que un Admin lo verifica.
  "directory.mark.aufNotVerified": "AUF sin verificar",
  "directory.mark.aufVerified": "AUF verificado",
  "directory.mark.membership.none": "Sin membresía",
  "directory.mark.membership.pending": "Membresía pendiente",
  "directory.mark.membership.trialing": "En prueba",
  "directory.mark.membership.active": "Membresía activa",
  "directory.mark.membership.pastDue": "Pago atrasado",
  "directory.mark.membership.cancelled": "Membresía cancelada",
  "directory.mark.membership.waived": "Membresía exenta",
  "directory.mark.notEvaluated": "Sin evaluar",
  "directory.mark.notEvaluatedLabel": "Sin evaluar: evaluar a {name}",
  "directory.error.signInRequired":
    "Tu sesión terminó. Vuelve a entrar para ver el directorio.",
  "directory.error.forbidden": "Tu cuenta no puede ver el directorio del club.",
  "directory.error.unexpected":
    "No pudimos cargar el directorio del club. Vuelve a intentarlo.",

  // La ficha reservada al Admin (#242, RF-4 del PRD de E5).
  "memberRecord.metaTitle": "Ficha del miembro · {club}",
  "memberRecord.metaDescription":
    "El registro AUF y los grupos de un miembro, que sólo edita un Admin.",
  "memberRecord.back": "Directorio",
  "memberRecord.openLabel": "Abrir la ficha de {name}",
  "memberRecord.loading": "Cargando la ficha del miembro…",
  "memberRecord.evaluation.title": "Evaluación",
  "memberRecord.evaluation.loading": "Cargando la evaluación…",
  "memberRecord.evaluation.open": "Abrir en Evaluaciones",
  "memberRecord.photoAlt": "Foto de {name}",
  "photoViewer.open": "Abrir la foto de {name}",
  "photoViewer.close": "Cerrar la foto",
  "photoViewer.alt": "Foto de {name}",
  "photoViewer.loading": "Cargando la foto…",
  "photoViewer.failed": "No se pudo cargar la foto.",
  "memberRecord.auf.title": "Registro AUF",
  "memberRecord.auf.number": "Número de AUF",
  "memberRecord.auf.expiry": "Vencimiento",
  "memberRecord.auf.hint":
    "Si borras el número, se borra también su vencimiento.",
  "memberRecord.auf.verify": "Verificar AUF",
  "memberRecord.auf.verifying": "Verificando…",
  "memberRecord.auf.verified": "AUF verificado.",
  "memberRecord.aufStrip.withExpiry":
    "{name} añadió el AUF {number} (vence el {date}). Revísalo y verifícalo.",
  "memberRecord.aufStrip.withoutExpiry":
    "{name} añadió el AUF {number}. Revísalo y verifícalo.",
  "memberRecord.birth.title": "Datos personales",
  "memberRecord.birth.label": "Fecha de nacimiento",
  "memberRecord.birth.hint":
    "El miembro no puede cambiarla: de ella depende si necesita el consentimiento de un tutor.",
  "memberRecord.birth.guardianNotice":
    "Al guardar, {name} tendrá que dar los datos y el consentimiento de su tutor la próxima vez que entre.",
  "memberRecord.groups.legend": "Grupos",
  // El teléfono y el contacto de emergencia que corrige el Admin (#499).
  "memberRecord.contact.title": "Contacto",
  "memberRecord.contact.phone": "Teléfono (opcional)",
  "memberRecord.contact.emergencyLegend": "Contacto de emergencia",
  "memberRecord.contact.emergencyHint":
    "A quién llama el club si a {name} le pasa algo en el agua. Rellena los tres datos o déjalos vacíos.",
  "memberRecord.contact.emergencyName": "Nombre del contacto",
  "memberRecord.contact.emergencyPhone": "Teléfono del contacto",
  "memberRecord.contact.emergencyRelationship": "Relación",
  "memberRecord.contact.samePhone":
    "Es el teléfono de {name}. El contacto de emergencia debería ser otra persona.",
  "memberRecord.groups.empty": "El club todavía no tiene grupos.",
  "memberRecord.save": "Guardar la ficha",
  "memberRecord.saving": "Guardando…",
  "memberRecord.saved": "Ficha guardada.",
  "memberRecord.issue.aufNumberTooLong":
    "El número de AUF no puede pasar de {max} caracteres.",
  "memberRecord.issue.aufExpiryNotADate":
    "Ese vencimiento no es una fecha válida.",
  "memberRecord.issue.aufExpiryBeforeJoined":
    "El vencimiento no puede ser anterior a su fecha de ingreso ({date}).",
  "memberRecord.issue.emergencyRelationshipMissing":
    "Escribe qué relación tiene con esa persona o deja los tres datos vacíos.",
  "memberRecord.issue.dateOfBirthRequired":
    "Una fecha de nacimiento ya registrada no se puede borrar.",
  "memberRecord.error.memberNotFound": "Ese miembro no está en el club.",
  "memberRecord.error.groupNotFound":
    "Uno de esos grupos ya no está en el club. Vuelve a cargar la ficha.",
  "memberRecord.error.memberInactive":
    "A un miembro con la cuenta desactivada no se le pueden agregar grupos.",
  "memberRecord.error.memberStatusChanged":
    "La cuenta del miembro cambió mientras se guardaba. Vuelve a cargar la ficha e inténtalo de nuevo.",
  "memberRecord.error.aufChanged":
    "El miembro cambió el AUF después de que abrieras la ficha. Recárgala antes de verificarlo.",
  "memberRecord.error.signInRequired":
    "Tu sesión terminó. Vuelve a entrar para seguir.",
  "memberRecord.error.forbidden":
    "Sólo un Admin puede ver y editar esta ficha.",
  "memberRecord.error.unexpected":
    "No pudimos guardar la ficha. Vuelve a intentarlo.",
  // La invitación de un miembro por un Admin (#243, RF-5 del PRD de E5), abierta
  // desde la cabecera del directorio.
  "directory.addMember": "Invitar miembro",
  // La exportación a CSV del directorio (#500, RF-5 del PRD de E19).
  "directory.export.open": "Exportar CSV",
  "directory.export.emptyReason": "No hay miembros en la lista que exportar.",
  "directory.export.error": "No se pudo exportar la lista. Inténtalo de nuevo.",
  // La selección múltiple del directorio (#552, RF-6 del PRD de E21).
  "directory.check.member": "Marcar a {name}",
  "directory.check.all": "Marcar a todos",
  "directory.bulk.label": {
    one: "{count} seleccionado",
    other: "{count} seleccionados",
  },
  "directory.bulk.email": "Escribir a los seleccionados",
  "directory.bulk.export": "Exportar los seleccionados",
  "directory.bulk.changeRole": "Cambiar rol",
  "directory.bulk.roleMenu": "Rol nuevo para los seleccionados",
  "directory.bulk.clear": "Quitar la selección",
  "directory.bulk.confirm": {
    one: "¿Cambiar {count} miembro a {role}?",
    other: "¿Cambiar {count} miembros a {role}?",
  },
  "directory.bulk.cancel": "Cancelar",
  "directory.bulk.save": "Cambiar roles",
  "directory.bulk.saving": "Cambiando…",
  "directory.bulk.changed": {
    one: "{count} miembro ahora es {role}.",
    other: "{count} miembros ahora son {role}.",
  },
  "directory.bulk.unchanged": {
    one: "{count} ya tenía ese rol.",
    other: "{count} ya tenían ese rol.",
  },
  "directory.bulk.failed": "Sin cambiar: {members}.",
  "directory.bulk.failedMember": "{name} ({reason})",
  "directory.bulk.reason.last_admin": "es el último Admin del club",
  "directory.bulk.reason.not_found": "ya no está en el club",
  "directory.bulk.reason.forbidden": "ya no eres Admin",
  "directory.bulk.reason.not_audited": "cambió, pero no quedó en la bitácora",
  "directory.bulk.reason.unexpected": "algo falló, inténtalo de nuevo",
  "directory.export.fileName": "directorio",
  "directory.export.column.name": "Nombre",
  "directory.export.column.aufNumber": "Número de AUF",
  "directory.export.column.aufExpiry": "Vencimiento del AUF",
  "directory.export.column.aufVerified": "AUF verificado",
  "directory.export.column.accountStatus": "Estado de la cuenta",
  "directory.export.column.membership": "Membresía",
  "directory.export.column.evaluated": "Evaluado",
  "directory.export.column.attendance": "Asistencia (%)",
  "directory.export.column.emergencyName": "Contacto de emergencia",
  "directory.export.column.emergencyPhone": "Teléfono de emergencia",
  "directory.export.column.emergencyRelationship": "Relación del contacto",
  "directory.export.status.incomplete": "Pendiente de activar",
  "directory.export.status.active": "Activa",
  "directory.export.status.inactive": "Desactivada",
  "directory.export.yes": "Sí",
  "directory.export.no": "No",
  "directory.email.open": "Escribir correo",
  "directory.email.emptyReason":
    "No hay miembros en la lista a quien escribir.",
  "directory.email.title": "Escribir a los miembros",
  "directory.email.lead":
    "Cada miembro recibe su propio correo desde la dirección del club, y las respuestas te llegan a tu correo.",
  "directory.email.recipients": {
    one: "{count} destinatario",
    other: "{count} destinatarios",
  },
  "directory.email.removeShort": "Quitar",
  "directory.email.remove": "Quitar a {name}",
  "directory.email.noRecipients":
    "La lista está vacía: no hay a quién mandarlo.",
  "directory.email.subject": "Asunto",
  "directory.email.message": "Mensaje",
  "directory.email.messageHint": "Texto plano. Sale tal como lo escribes.",
  "directory.email.error.subjectRequired": "Escribe el asunto.",
  "directory.email.error.subjectTooLong":
    "El asunto puede tener como mucho {max} caracteres.",
  "directory.email.error.messageRequired": "Escribe el mensaje.",
  "directory.email.error.messageTooLong":
    "El mensaje puede tener como mucho {max} caracteres.",
  "directory.email.send": "Enviar",
  "directory.email.close": "Cerrar",
  "directory.email.confirm.title": "¿Mandar el correo?",
  "directory.email.confirm.recipients": {
    one: "Va a {count} miembro.",
    other: "Va a {count} miembros.",
  },
  "directory.email.confirm.remaining": {
    one: "Hoy queda {count} correo del directorio.",
    other: "Hoy quedan {count} correos del directorio.",
  },
  "directory.email.confirm.loadingQuota": "Mirando cuántos correos quedan hoy…",
  "directory.email.confirm.quotaUnknown":
    "No se pudo saber cuántos correos quedan hoy.",
  "directory.email.confirm.send": "Mandar",
  "directory.email.confirm.sending": "Mandando…",
  "directory.email.confirm.cancel": "Cancelar",
  "directory.email.result.sent": {
    one: "Se mandó {count} correo.",
    other: "Se mandaron {count} correos.",
  },
  "directory.email.result.failed": "No llegó a:",
  "directory.email.error.quotaExceeded": {
    one: "No caben: hoy el directorio puede mandar {count} correo más. Quita miembros de la lista o inténtalo más tarde.",
    other:
      "No caben: hoy el directorio puede mandar {count} correos más. Quita miembros de la lista o inténtalo más tarde.",
  },
  "directory.email.error.quotaExceededUnknown":
    "No caben en lo que el directorio puede mandar hoy. Quita miembros de la lista o inténtalo más tarde.",
  "directory.email.error.unavailable":
    "El envío de correos no está disponible ahora. Inténtalo más tarde.",
  "directory.email.error.duplicate": "Este correo ya se mandó.",
  "directory.email.error.forbidden":
    "Tu rol ya no puede mandar correos desde el directorio.",
  "directory.email.error.noRecipients":
    "Ninguno de los miembros de la lista puede recibirlo: puede que su cuenta esté desactivada.",
  "directory.email.error.unexpected":
    "No se pudo mandar el correo. Inténtalo de nuevo.",
  "newMember.metaTitle": "Invitar miembro · {club}",
  "newMember.metaDescription":
    "Invita a un miembro al club y mándale el correo para activar su cuenta.",
  "newMember.title": "Invitar miembro",
  "newMember.lead":
    "Entra como Player y recibe un correo para activar su cuenta. Su rol se cambia desde el directorio.",
  "newMember.loading": "Cargando los grupos del club…",
  "newMember.loadFailed":
    "No pudimos cargar los grupos del club. Inténtalo de nuevo.",
  "newMember.details.title": "Datos del miembro",
  "newMember.fullName": "Nombre completo",
  "newMember.email": "Correo",
  "newMember.country": "País",
  "newMember.position": "Posición",
  "newMember.experienceLevel": "Nivel de experiencia",
  "newMember.gender": "Género",
  "newMember.choose": "Elige una opción",
  "newMember.auf.title": "Registro AUF",
  "newMember.auf.number": "Número de AUF",
  "newMember.auf.expiry": "Vencimiento del AUF",
  "newMember.submit": "Invitar miembro",
  "newMember.sending": "Invitando…",
  "newMember.created.sent":
    "Invitamos a {name}. Le mandamos la invitación a {email}.",
  "newMember.created.notSent":
    "Creamos la cuenta de {name}, pero la invitación no se pudo mandar.",
  "newMember.resend": "Reenviar la invitación",
  "newMember.resending": "Reenviando…",
  "newMember.resent": "Le mandamos una invitación nueva a {email}.",
  "newMember.addAnother": "Invitar a otro miembro",
  "newMember.issue.fullNameMissing": "Escribe el nombre del miembro.",
  "newMember.issue.emailMalformed": "Escribe una dirección de correo válida.",
  "newMember.issue.countryUnknown": "Elige un país.",
  "newMember.issue.positionUnknown": "Elige una posición.",
  "newMember.issue.experienceLevelUnknown": "Elige un nivel de experiencia.",
  "newMember.issue.genderUnknown": "Elige una opción.",
  "newMember.issue.aufNumberMissing": "Escribe el número de AUF.",
  "newMember.issue.aufNumberTooLong":
    "El número de AUF no puede pasar de {max} caracteres.",
  "newMember.issue.aufExpiryNotADate": "Escribe el vencimiento del AUF.",
  "newMember.issue.aufExpiryInThePast": "Ese AUF ya venció. Revisa la fecha.",
  "newMember.error.emailTaken": "Ese correo ya tiene una cuenta en el club.",
  "newMember.error.groupNotFound":
    "Uno de esos grupos ya no está en el club. Recarga la página.",
  "newMember.error.invitationNotSent":
    "La invitación no se pudo mandar. Inténtalo más tarde.",
  "newMember.error.rateLimited":
    "Se mandaron varias invitaciones seguidas. Espera unos minutos antes de pedir otra.",
  "newMember.error.forbidden": "Sólo un Admin puede invitar a miembros.",
  "newMember.error.unexpected":
    "No pudimos invitar al miembro. Inténtalo de nuevo.",
  "newMember.error.invitationNotPending": "Este miembro ya activó su cuenta.",
  "memberRecord.invitation.title": "Invitación",
  "memberRecord.role.title": "Rol",
  "memberRecord.invitation.lead":
    "{name} todavía no activó su cuenta. El enlace de la invitación caduca a la hora, así que puedes mandarle uno nuevo.",
  "memberRecord.invitation.resent":
    "Le mandamos una invitación nueva a {name}.",
  "memberStatus.title": "Membresía",
  "memberStatus.lead.active":
    "{name} es miembro del club. Si desactivas su cuenta, su historial se conserva, pero {name} deja de entrar y de aparecer en el directorio.",
  "memberStatus.lead.inactive":
    "La cuenta de {name} está desactivada. Su historial se conserva, y si la reactivas, {name} vuelve a entrar y a aparecer en el directorio.",
  "memberStatus.deactivate": "Desactivar cuenta",
  "memberStatus.reactivate": "Reactivar cuenta",
  "memberStatus.saving": "Guardando…",
  "memberStatus.deactivated": "La cuenta de {name} quedó desactivada.",
  "memberStatus.reactivated": "La cuenta de {name} quedó reactivada.",
  "memberStatus.error.lastAdmin":
    "Es el último Admin del club y su cuenta no se puede desactivar. Nombra antes a otro Admin.",
  "memberStatus.error.selfDeactivation":
    "No puedes desactivar tu propia cuenta: la de un Admin la desactiva otro Admin.",
  "memberStatus.error.notAudited":
    "La membresía cambió, pero no quedó en la bitácora. Recarga la ficha y avisa a quien mantiene la plataforma.",
  "memberStatus.error.unexpected":
    "No pudimos cambiar la membresía. Vuelve a intentarlo.",
  // La exención de cuota desde la ficha (#457, RF-4 de E12).
  "membershipWaiver.title": "Cuota",
  "membershipWaiver.lead.notWaived":
    "{name} paga la cuota en Pagos. A entrenadores y voluntarios se les puede eximir.",
  "membershipWaiver.lead.waived":
    "{name} no paga cuota mientras dure la exención.",
  "membershipWaiver.reason": "Motivo: {reason}",
  "membershipWaiver.until": "Termina el {date}",
  "membershipWaiver.noEndDate": "Sin fecha de fin",
  "membershipWaiver.waive": "Eximir de cuota",
  "membershipWaiver.remove": "Retirar la exención",
  "membershipWaiver.dialog.waiveTitle": "Eximir de cuota a {name}",
  "membershipWaiver.dialog.waiveLead":
    "Quedará al día sin pagar. Si tiene suscripción en Stripe, se cancela al final del periodo ya pagado.",
  "membershipWaiver.field.reason": "Motivo",
  "membershipWaiver.field.reasonHint": "Obligatorio, hasta 200 caracteres.",
  "membershipWaiver.field.until": "Fecha de fin (opcional)",
  "membershipWaiver.field.untilHint":
    "La exención deja de contar ese día. Déjala vacía si no termina.",
  "membershipWaiver.confirmWaive": "Eximir",
  "membershipWaiver.cancel": "Cancelar",
  "membershipWaiver.saving": "Guardando…",
  "membershipWaiver.dialog.removeTitle": "¿Retirar la exención de {name}?",
  "membershipWaiver.dialog.removeLead":
    "Su membresía vuelve a pendiente, o a lo que quede de su suscripción de Stripe, que sigue terminando al final de su periodo. Mientras no esté al día no podrá usar las funciones de miembro.",
  "membershipWaiver.confirmRemove": "Retirar la exención",
  "membershipWaiver.waived": "La cuota de {name} queda exenta.",
  "membershipWaiver.removed": "Se retiró la exención de {name}.",
  "membershipWaiver.error.reasonRequired": "Escribe el motivo de la exención.",
  "membershipWaiver.error.reasonTooLong":
    "El motivo no puede pasar de 200 caracteres.",
  "membershipWaiver.error.untilNotADate":
    "La fecha de fin no es un día válido.",
  "membershipWaiver.error.untilNotAfterToday":
    "La fecha de fin tiene que ser posterior a hoy.",
  "membershipWaiver.error.notWaived":
    "La cuota de este miembro ya no está exenta. Vuelve a cargar la ficha.",
  "membershipWaiver.error.notAudited":
    "La exención cambió, pero no se pudo registrar en la bitácora. Vuelve a cargar la ficha y avisa a quien mantiene la plataforma.",
  "membershipWaiver.error.unexpected":
    "No pudimos guardar la exención. Vuelve a intentarlo.",
  // La campana y su lista (#266). Cada tipo de aviso tiene su título y su
  // cuerpo; los datos del aviso entran como parámetros.
  "notifications.bell.label": {
    one: "Avisos, {count} sin leer",
    other: "Avisos, {count} sin leer",
  },
  "notifications.bell.labelNoneUnread": "Avisos, ninguno sin leer",
  "notifications.panel.title": "Avisos",
  "notifications.panel.markAllRead": "Marcar todo como leído",
  "notifications.panel.back": "Volver",
  "notifications.panel.loading": "Cargando tus avisos…",
  "notifications.panel.empty": "Todavía no tienes avisos.",
  "notifications.panel.unread": "Nuevo",
  "notifications.panel.error.load": "No pudimos cargar tus avisos.",
  "notifications.panel.error.markRead":
    "No pudimos marcar tus avisos como leídos.",
  "notifications.panel.retry": "Reintentar",
  "notifications.role_changed.title": "Tu rol cambió",
  "notifications.role_changed.body": "Ahora eres {role}.",
  "notifications.role_request_rejected.title": "Solicitud de rol rechazada",
  "notifications.role_request_rejected.body":
    "Un Admin rechazó tu solicitud para ser {role}.",
  "notifications.role_request_received.title": "Nueva solicitud de rol",
  "notifications.role_request_received.body": "{name} pidió ser {role}.",
  "notifications.news_post_published.title": "Nueva publicación: {category}",
  "notifications.event_created.title": "Nuevo evento: {eventType}",
  "notifications.event_created.body": "{title}: {moment}",
  "notifications.event_created.bodyWithAddress":
    "{title}: {moment}, en {address}",
  "notifications.event_series_created.title": "Nueva serie: {eventType}",
  // Una coma y no "a las", como en `format.ts`: "a las" falla con la una.
  "notifications.event_series_created.body":
    "{title}: {weekdays}, {time}, del {startsOn} al {endsOn}",
  "notifications.event_series_created.bodyWithAddress":
    "{title}: {weekdays}, {time}, del {startsOn} al {endsOn}, en {address}",
  "notifications.event_changed.title": "Evento cambiado",
  "notifications.event_changed.body":
    "{title}: ahora el {moment}, en {location}",
  "notifications.event_cancelled.title": "Evento cancelado",
  "notifications.event_cancelled.body": "{title}: {moment}",
  "notifications.event_series_changed.title": "Serie cambiada",
  "notifications.event_series_changed.body":
    "{title}: ahora {weekdays}, {time}, en {location}",
  "notifications.event_series_changed.bodyWithEnd":
    "{title}: ahora {weekdays} hasta el {endsOn}, {time}, en {location}",
  "notifications.event_series_cancelled.title": "Serie cancelada",
  "notifications.event_series_cancelled.body":
    "{title}: {weekdays}, {time}, de hoy en adelante",
  "notifications.team_assigned.title": "Juegas en {team}",
  "notifications.team_assigned.body": "{title}: {moment}",
  "notifications.team_unassigned.title": "Ya no estás en ningún equipo",
  "notifications.team_unassigned.body": "{title}: {moment}",
  // #470: siete días antes de cada renovación.
  "notifications.membership_renewal_upcoming.title":
    "Tu membresía se renueva pronto",
  "membership.renewal.charge": "El {date} se cobrarán {amount} en tu {card}.",
  "membership.renewal.chargeWithoutCard": "El {date} se cobrarán {amount}.",
  "membership.renewal.card": "{brand} terminada en {last4}",
  "event.type.training": "Entrenamiento",
  "event.type.competition": "Competición",
  "event.type.meeting": "Reunión",
  "event.type.social": "Social",
  // La agenda del Calendario (#311, RF-5 a RF-7 del PRD de E7).
  "calendar.eyebrow": "Calendario y eventos",
  "calendar.title": "Próximos eventos",
  "calendar.loading": "Cargando los eventos…",
  "calendar.empty": "No hay eventos próximos.",
  "calendar.loadMore": "Ver más",
  "calendar.loadingMore": "Cargando…",
  "calendar.retry": "Volver a intentarlo",
  "calendar.error.signInRequired":
    "Tu sesión terminó. Vuelve a entrar para ver el calendario.",
  "calendar.error.unexpected":
    "No pudimos cargar los eventos. Vuelve a intentarlo.",
  "calendar.event.cancelled": "Cancelado",
  "calendar.event.timeAndPlace": "{time} · {location}",
  "calendar.event.going": {
    one: "{count} va",
    other: "{count} van",
  },
  "calendar.event.maybe": {
    one: "{count} quizás",
    other: "{count} quizás",
  },
  "calendar.event.counts": "{going} · {maybe}",
  "calendar.types.label": "Tipos de evento",
  "calendar.types.empty": "No hay eventos de los tipos elegidos.",
  "calendar.types.showAll": "Mostrar todos los tipos",
  "calendar.day.today": "Hoy",
  "calendar.day.thisWeekend": "Este fin de semana",
  "calendar.event.repeats": "Se repite",
  "calendar.event.opensMap": "(mapa, se abre en otra pestaña)",
  "calendar.answer.label": "Tu respuesta:",
  "calendar.answer.yes": "Voy",
  "calendar.answer.maybe": "Quizás",
  "calendar.answer.no": "No puedo",
  "calendar.answer.missing": "¿Vas?",
  "calendar.answer.missingHint": "Aún no has respondido.",
  "calendar.rsvp.label": "¿Vas?",
  "calendar.rsvp.groupLabel": "Tu respuesta a {title}",
  "calendar.rsvp.rowGroupLabel": "¿Vas a {title}?",
  "calendar.rsvp.yes": "Sí",
  "calendar.rsvp.maybe": "Quizás",
  "calendar.rsvp.no": "No",
  "calendar.rsvp.saving": "Guardando…",
  "calendar.rsvp.error.network":
    "No pudimos guardar tu respuesta. Revisa tu conexión y vuelve a intentarlo.",
  "calendar.rsvp.error.started":
    "Este evento ya empezó: ya no se puede responder.",
  "calendar.rsvp.error.cancelled":
    "Este evento se canceló: ya no se puede responder.",
  "calendar.rsvp.error.notFound":
    "Este evento ya no está disponible. Recarga el calendario.",
  "calendar.rsvp.error.signInRequired":
    "Tu sesión terminó. Vuelve a entrar para responder.",
  "calendar.rsvp.error.membershipNotCurrent":
    "Tu membresía no está al día. Ponla al día en Pagos para responder.",
  // La alerta de pago fallido en toda la aplicación (#474, RF-7 de E13).
  "failedPayment.title": "Pago fallido",
  "failedPayment.dated": "No se pudo cobrar tu cuota del {date}.",
  "failedPayment.undated": "No se pudo cobrar tu última cuota.",
  "failedPayment.retry": "Reintentar el pago",
  "failedPayment.error.nothingPending": "No hay nada pendiente de pago.",
  "failedPayment.error.stripeFailed":
    "No se pudo abrir el pago. Vuelve a intentarlo en un momento.",
  "membership.block.pending":
    "Tu membresía está pendiente: todavía no has añadido una tarjeta.",
  "membership.block.pastDue": "Tu último pago no se pudo cobrar.",
  "membership.block.cancelled": "Tu membresía está cancelada.",
  "membership.block.scope":
    "Hasta que esté al día solo ves tu perfil, Pagos y el calendario.",
  "calendar.membership.notice":
    "Tu membresía no está al día: todavía no puedes responder a los eventos.",
  "calendar.membership.toPayments": "Ir a Pagos",
  // Pagos con el alta en Stripe Checkout (#454, RF-3 del PRD de E12).
  "payments.offer.trial":
    "El primer mes es gratis. El primer cobro es dentro de 30 días, y después uno cada mes.",
  "payments.offer.noTrial":
    "Ya tuviste tu mes gratis, así que el primer cobro es hoy, y después uno cada mes.",
  "payments.offer.stripe":
    "La tarjeta la pones en Stripe: nunca pasa por la aplicación del club.",
  "payments.offer.addCard": "Añadir tarjeta",
  "payments.offer.opening": "Abriendo Stripe…",
  "payments.offer.retry": "Reintentar",
  "payments.offer.notConfigured":
    "Los pagos todavía no están configurados. Escribe al club para que un Admin active tu membresía.",
  "payments.checkout.cancelled":
    "Saliste de Stripe sin añadir la tarjeta. Puedes intentarlo otra vez cuando quieras.",
  "payments.checkout.waiting":
    "Tarjeta añadida. Estamos esperando la confirmación de Stripe, que puede tardar unos segundos.",
  "payments.checkout.timedOut":
    "Stripe todavía no ha confirmado. Recarga la página en un minuto; si tu membresía sigue sin cambiar, escribe al club.",
  // Los packs de sesiones de un Casual (#471, RF-5 del PRD de E13).
  "payments.packs.title": "Packs de sesiones",
  "payments.packs.lead":
    "Cada entrenamiento al que vas gasta una sesión. Pagas una vez en Stripe, sin cobros recurrentes.",
  "payments.packs.loading": "Cargando los packs de sesiones…",
  "payments.packs.loadFailed":
    "No pudimos cargar los packs de sesiones. Recarga la página para intentarlo otra vez.",
  "payments.packs.buy": "Comprar {pack} · {price}",
  "payments.packs.waiting":
    "Pack pagado. Estamos esperando la confirmación de Stripe, que puede tardar unos segundos.",
  "payments.packs.paid":
    "Pack pagado. Tus sesiones se suman en cuanto Stripe confirma el pago.",
  "payments.packs.cancelled":
    "Saliste de Stripe sin comprar un pack. Puedes intentarlo otra vez cuando quieras.",
  // Los levies que el comité crea en Stripe (#473, RF-6 del PRD de E13),
  // presentados como extras opcionales del club (#633, D1 del PRD de E23).
  "payments.tabs.label": "Secciones de Pagos",
  "payments.tabs.membership": "Mi membresía",
  "payments.tabs.extras": "Extras del club",
  "payments.tabs.extrasForSale": "{count} a la venta",
  "payments.levies.title": "Extras del club",
  "payments.levies.lead": "Opcional · compra lo que necesites",
  "payments.levies.loadFailed":
    "No pudimos cargar los extras del club. Recarga la página para intentarlo otra vez.",
  "payments.levies.pay": "Comprar",
  "payments.levies.paid": "Comprado",
  "payments.levies.boughtOn": "Comprado el {date}",
  "payments.levies.boughtCount": "Comprado × {count}",
  "payments.levies.waiting":
    "Pago recibido. Estamos esperando a que Stripe lo confirme, puede tardar unos segundos.",
  "payments.levies.timedOut":
    "Stripe todavía no lo ha confirmado. Recarga la página en un minuto; si el extra sigue sin aparecer, escribe al club.",
  "payments.levies.cancelled":
    "Saliste de Stripe sin comprar el extra. Puedes intentarlo cuando quieras.",
  // Quién compró cada extra (#531, #635), sólo para Admin y Committee.
  "payments.levyPayers.loading": "Cargando compradores…",
  "payments.levyPayers.loadFailed":
    "No pudimos cargar quién compró este extra. Inténtalo otra vez en un momento.",
  "payments.levyPayers.retry": "Reintentar",
  "payments.levyPayers.sold": "Vendidos",
  "payments.levyPayers.buyers": "Compradores",
  "payments.levyPayers.units": "× {count}",
  "payments.levyPayers.noPayments": "Todavía nadie ha comprado este extra.",
  "payments.levyPayers.export": "Exportar CSV",
  // La pestaña Extras del club de un Admin o un Committee (#635, RF-9 del
  // PRD de E23): lo vendido de cada extra, sin cifras de dinero (D3).
  "payments.levySales.lead": {
    one: "{count} extra a la venta · creado por el comité en Stripe",
    other: "{count} extras a la venta · creados por el comité en Stripe",
  },
  "payments.levySales.column.extra": "Extra",
  "payments.levySales.column.price": "Precio",
  "payments.levySales.column.sold": "Vendidos",
  "payments.levySales.soldCount": {
    one: "{count} vendido",
    other: "{count} vendidos",
  },
  "payments.levySales.sheetClose": "Cerrar el detalle",
  "payments.levySales.closedTitle": "Cerrados",
  "payments.levySales.loading": "Cargando los extras del club…",
  "payments.levySales.loadFailed":
    "No pudimos cargar los extras del club. Inténtalo otra vez en un momento.",
  "payments.levySales.empty":
    "Todavía no hay extras del club. El comité los crea en Stripe y aparecen aquí.",
  "payments.levySales.notConfigured":
    "Los pagos aún no están configurados. Los extras del club aparecen aquí cuando el club conecte Stripe.",
  "payments.levyPayers.csv.column.name": "Nombre",
  "payments.levyPayers.csv.column.email": "Correo",
  "payments.levyPayers.csv.column.units": "Unidades",
  "payments.levyPayers.csv.column.option": "Opción",
  "payments.levyPayers.csv.column.date": "Fecha del pago",
  "payments.levyPayers.csv.column.amount": "Importe (AUD)",
  "payments.levyPayers.csv.fileName": "pagos",
  "payments.trialing": "En prueba hasta el día {date}",
  "payments.error.unavailable":
    "No pudimos abrir Stripe. Vuelve a intentarlo en un momento.",
  "payments.error.unexpected":
    "Algo falló al abrir Stripe. Vuelve a intentarlo.",
  // El panel de membresía (#455, RF-5 y RF-7 del PRD de E12).
  "payments.loading": "Cargando tu membresía…",
  "payments.load.failed":
    "No pudimos cargar tu membresía. Vuelve a intentarlo.",
  "payments.load.retry": "Reintentar",
  "payments.plan.title": "Plan actual",
  "payments.plan.name": "Membresía {plan}",
  "payments.plan.monthlyPrice": "{price} al mes",
  "payments.plan.priceUnavailable": "Precio no disponible",
  "payments.plan.nextCharge": "Próximo cobro el {date}",
  "payments.plan.noRecurringCharge": "Sin cobro recurrente",
  "payments.plan.card": "{brand} terminada en {last4}, caduca {expiry}",
  "payments.status.active": "Activa",
  "payments.status.trialing": "En prueba",
  "payments.status.pending": "Pendiente",
  "payments.status.pastDue": "Pago fallido",
  "payments.status.cancelled": "Cancelada",
  "payments.status.waived": "Exenta",
  "payments.waiver.reason": "Motivo: {reason}",
  "payments.waiver.until": "Hasta el {date}",
  "payments.waiver.subscriptionEnds":
    "Tu suscripción termina el {date} y no se te volverá a cobrar",
  "payments.card.update": "Actualizar tarjeta",
  "payments.card.resubscribe": "Volver a suscribirse",
  "payments.card.waiting":
    "Tu tarjeta nueva está guardada en Stripe. Aparece aquí en cuanto Stripe la confirme.",
  "payments.card.timedOut":
    "Si todavía no ves tu tarjeta nueva, recarga la página en un minuto.",
  "payments.card.cancelled":
    "Saliste de Stripe sin cambiar la tarjeta. La que tienes sigue valiendo.",
  "payments.history.title": "Historial de pagos",
  "payments.history.date": "Fecha",
  "payments.history.description": "Descripción",
  "payments.history.amount": "Importe",
  "payments.history.status": "Estado",
  "payments.history.defaultDescription": "Pago de membresía",
  "payments.history.empty": "Todavía no hay pagos.",
  "payments.history.paid": "Pagado",
  "payments.history.failed": "Fallido",
  "payments.history.pending": "Pendiente",
  "payments.history.method": "Método",
  "payments.history.receipt": "Recibo",
  "payments.history.noMethod": "—",
  "payments.history.filter.label": "Filtrar por estado",
  "payments.history.filter.all": "Todos",
  "payments.history.filter.paid": "Pagados",
  "payments.history.filter.failed": "Fallidos",
  "payments.history.filter.pending": "Pendientes",
  "payments.history.noMatches": "Ningún pago coincide con este filtro.",
  "payments.history.byMonth": "Pagos por mes",
  "payments.history.viewReceipt": "Ver recibo de {description}",
  "payments.history.receiptFailed":
    "No pudimos abrir el recibo. Vuelve a intentarlo.",
  "payments.history.export": "Exportar CSV",
  "payments.history.csv.column.date": "Fecha",
  "payments.history.csv.column.description": "Descripción",
  "payments.history.csv.column.method": "Método",
  "payments.history.csv.column.amount": "Importe (AUD)",
  "payments.history.csv.column.status": "Estado",
  "payments.history.csv.fileName": "pagos",
  "payments.sessions.left": {
    one: "Te queda {count} sesión",
    other: "Te quedan {count} sesiones",
  },
  "payments.sessions.empty": "Compra un pack para seguir entrenando.",
  "payments.sessions.frozen": {
    one: "Saldo congelado: {count} sesión",
    other: "Saldo congelado: {count} sesiones",
  },
  "payments.sessions.frozenHint":
    "Congelado mientras tengas un plan mensual: vuelve a valer si pasas a Casual.",
  "payments.sessions.activity.title": "Movimientos de sesiones",
  "payments.sessions.activity.date": "Fecha",
  "payments.sessions.activity.movement": "Movimiento",
  "payments.sessions.activity.sessions": "Sesiones",
  "payments.sessions.activity.empty": "Todavía no hay movimientos de sesiones.",
  "payments.sessions.activity.pack": {
    one: "Pack de {count} sesión",
    other: "Pack de {count} sesiones",
  },
  "payments.sessions.activity.training": "Entrenamiento del {date}: {title}",
  "payments.sessions.activity.trainingUnavailable": "Entrenamiento",
  "payments.choice.title": "Elige tu membresía",
  "payments.choice.hint": "Puedes cambiarla mientras no hayas pagado.",
  "payments.choice.sessionPrice": "{price} por sesión",
  "payments.choice.trial": "Primer mes gratis",
  "payments.choice.packs": "Se paga en packs de sesiones",
  "payments.choice.saving": "Guardando…",
  "payments.choice.failed":
    "No pudimos guardar tu elección. Inténtalo de nuevo.",
  "payments.planChange.title": "Cambiar de plan",
  "payments.planChange.open": "Cambiar plan",
  "payments.planChange.hint":
    "El cambio empieza con tu siguiente ciclo de cobro, sin prorrateo.",
  "payments.planChange.casualHint": "Al elegir Full o Student vas a Stripe.",
  "payments.planChange.recurringOption": "{plan} · {price} al mes",
  "payments.planChange.recurringOptionPriceUnavailable":
    "{plan} · Precio no disponible",
  "payments.planChange.casualOption": "Casual · Sin cobro recurrente",
  "payments.planChange.confirm": "Confirmar el cambio",
  "payments.planChange.saving": "Guardando…",
  "payments.planChange.retry": "Reintentar",
  "payments.planChange.scheduled": "Pasa a {plan} el {date}.",
  "payments.planChange.scheduledCasual":
    "Pasa a Casual el {date}: ese día termina tu suscripción.",
  "payments.planChange.cancel": "Anular el cambio",
  "payments.planChange.unavailable":
    "Stripe no contesta, así que no cambió nada. Vuelve a intentarlo en un momento.",
  "payments.planChange.failed":
    "No pudimos cambiar tu plan. Recarga la página y vuelve a intentarlo.",
  "account.membership.title": "Membresía",
  "account.membership.type": "Tipo de membresía: {plan}",
  "account.membership.none": "Todavía no elegiste tipo de membresía.",
  "account.membership.change": "Cambiarlo en Pagos",
  "calendar.rsvp.error.unexpected":
    "No pudimos guardar tu respuesta. Vuelve a intentarlo.",
  "calendar.create.open": "Evento",
  "calendar.create.created": "Evento creado. Avisamos a los miembros.",
  "calendar.create.createdSeries": {
    one: "Se creó {count} sesión. Avisamos a los miembros.",
    other: "Se crearon {count} sesiones. Avisamos a los miembros.",
  },
  "calendar.edit.titleEvent": "Editar evento",
  "calendar.edit.titleSeries": "Editar serie",
  "calendar.edit.submit": "Guardar cambios",
  "calendar.edit.barSubmit": "Guardar",
  "calendar.edit.seriesWarning":
    "Estos cambios se aplican a esta sesión y a todas las siguientes, también a las que se editaron solas.",
  "calendar.manage.edit": "Editar",
  "calendar.manage.cancel": "Cancelar",
  "calendar.manage.editScope.question":
    "Este evento se repite. ¿Qué quieres editar?",
  "calendar.manage.editScope.session": "Solo esta sesión",
  "calendar.manage.editScope.sessionHint":
    "Cambia solo el {date}. Las demás quedan igual.",
  "calendar.manage.editScope.following": "Esta y las siguientes",
  "calendar.manage.editScope.close": "Cancelar",
  "calendar.manage.scopeQuestion.cancel": "¿Qué sesiones quieres cancelar?",
  "calendar.manage.scope.event": "Solo esta",
  "calendar.manage.scope.series": "Toda la serie de hoy en adelante",
  "calendar.manage.back": "Volver",
  "calendar.manage.cancelQuestion.event": {
    one: "{count} persona dijo que va. Avisaremos a la audiencia de que se cancela.",
    other:
      "{count} personas dijeron que van. Avisaremos a la audiencia de que se cancela.",
  },
  "calendar.manage.cancelQuestion.series": {
    one: "Se cancelan todas las sesiones de hoy en adelante. {count} persona dijo que va a esta.",
    other:
      "Se cancelan todas las sesiones de hoy en adelante. {count} personas dijeron que van a esta.",
  },
  "calendar.manage.confirm.event": "Cancelar evento",
  "calendar.manage.confirm.series": "Cancelar serie",
  "calendar.manage.cancelling": "Cancelando…",
  "calendar.manage.keep": "No cancelar",
  "calendar.manage.edited": "Cambios guardados.",
  "calendar.manage.editedSeries": {
    one: "Cambios guardados en {count} sesión.",
    other: "Cambios guardados en {count} sesiones.",
  },
  "calendar.manage.cancelled": "Evento cancelado. Avisamos a la audiencia.",
  "calendar.manage.cancelledSeries": {
    one: "Cancelamos {count} sesión. Avisamos a la audiencia.",
    other: "Cancelamos {count} sesiones. Avisamos a la audiencia.",
  },
  "calendar.manage.closed.event_started":
    "Este evento ya empezó, así que ya no se puede cambiar. Actualizamos el calendario.",
  "calendar.manage.closed.event_cancelled":
    "Este evento ya estaba cancelado. Actualizamos el calendario.",
  "calendar.manage.closed.series_without_upcoming":
    "Esta serie ya no tiene sesiones de hoy en adelante. Actualizamos el calendario.",
  "calendar.manage.closed.occurrence_started":
    "Esta sesión ya empezó, así que ya no se puede cambiar. Actualizamos el calendario.",
  "calendar.manage.closed.session_not_in_series":
    "Esta serie cambió mientras la editabas. Actualizamos el calendario.",
  "calendar.manage.closed.not_found":
    "Este evento ya no existe. Actualizamos el calendario.",
  "calendar.manage.error.seriesChanged":
    "Esta serie cambió mientras la editabas. Recarga para ver la versión actual.",
  "calendar.manage.reload": "Recargar",
  "calendar.manage.error.forbidden": "Tu rol no puede cambiar eventos.",
  "calendar.manage.error.unexpected":
    "No pudimos guardar el cambio. Vuelve a intentarlo.",
  "calendar.form.title": "Nuevo evento",
  "calendar.form.close": "Cerrar",
  "calendar.form.loading": "Cargando los grupos del club…",
  "calendar.form.loadFailed":
    "No pudimos cargar los grupos del club. Vuelve a intentarlo.",
  "calendar.form.retry": "Reintentar",
  "calendar.form.titleLabel": "Título",
  "calendar.form.titlePlaceholder": "p. ej. Entrenamiento en piscina",
  "calendar.form.type": "Tipo",
  "calendar.form.date": "Fecha",
  "calendar.form.when": "Cuándo",
  "calendar.form.startTime": "Empieza",
  "calendar.form.endTime": "Termina",
  "calendar.form.lasts": "Dura {duration}",
  "calendar.form.endTimeNowRequired":
    "Ahora los eventos necesitan hora de fin. Añádela para guardar.",
  "calendar.form.endsAnotherDay": "Termina otro día",
  "calendar.form.endDate": "Fecha de fin",
  "calendar.form.quickLength": "Duración rápida",
  "calendar.form.image": "Imagen",
  "calendar.form.image.optional": "opcional",
  "calendar.form.image.fallback": "Sin imagen, se usa el fondo de {type}.",
  "calendar.form.image.add": "Añadir imagen",
  "calendar.form.image.choose": "Elegir una imagen",
  "calendar.form.image.remove": "Quitar imagen",
  "calendar.form.image.preview": "La imagen del evento",
  "calendar.form.image.uploading": "Subiendo la imagen…",
  "calendar.form.image.uploadFailed":
    "No pudimos subir la imagen. Inténtalo de nuevo.",
  "calendar.form.location": "Lugar",
  "calendar.form.locationPlaceholder": "Busca un lugar o escríbelo",
  "calendar.form.place.suggestions": "Lugares sugeridos",
  "calendar.form.place.freeText":
    "O deja lo que escribiste como texto libre (no abrirá un mapa).",
  "calendar.form.place.searchUnavailable":
    "La búsqueda de lugares no está disponible ahora. Elige uno de los lugares del club o deja lo que escribiste.",
  "calendar.form.place.checkOnMap": "Ver en el mapa",
  "calendar.form.place.change": "Cambiar el lugar",
  "calendar.form.place.detail": "Dónde exactamente",
  "calendar.form.place.optional": "opcional",
  "calendar.form.place.detailPlaceholder": "p. ej. Campo 2, junto al pabellón",
  "calendar.form.notes": "Notas",
  "calendar.form.repeat": "Repetición",
  "calendar.form.repeat.none": "Una vez",
  "calendar.form.repeat.weekly": "Semanal",
  "calendar.form.weekdays": "Estos días",
  "calendar.form.weekly.everyDays": "Todos los {days}",
  "calendar.form.weekly.everyDay": "Todos los días",
  "calendar.form.weekly.summary":
    "{days}, {hours} · {sessions} hasta el {date}",
  "calendar.form.weekly.sessions": {
    one: "{count} sesión",
    other: "{count} sesiones",
  },
  "calendar.form.weekly.next": "Próximas:",
  "calendar.form.weekly.more": "+{count} más",
  "calendar.form.weekly.hint":
    "Cada sesión tiene su propio RSVP y su asistencia. Puedes editar o cancelar una sola.",
  "calendar.form.weekly.noDays": "Elige al menos un día.",
  "calendar.form.weekly.noSessions":
    "No cae ninguna sesión entre el inicio y la fecha final.",
  "calendar.form.startsOn": "Empieza el",
  "calendar.form.endsOn": "Hasta",
  "calendar.form.audience": "A quién va",
  "calendar.form.cancel": "Cancelar",
  "calendar.form.submit": "Crear evento",
  "calendar.form.barSubmit": "Crear",
  "calendar.form.discardQuestion":
    "Tienes cambios sin guardar. ¿Salir y descartarlos?",
  "calendar.form.sending": "Guardando…",
  "calendar.form.issue.required": "Rellena este campo.",
  "calendar.form.issue.event_title_invalid":
    "Escribe un título de hasta {max} caracteres.",
  "calendar.form.issue.event_location_invalid":
    "Escribe un lugar de hasta {max} caracteres.",
  "calendar.form.issue.event_place_invalid":
    "Ese lugar no se puede guardar. Elige otro o deja el texto.",
  "calendar.form.issue.event_place_coordinates_invalid":
    "La posición de ese lugar no es válida. Elige otro o deja el texto.",
  "calendar.form.issue.event_place_detail_invalid":
    "Dónde exactamente puede tener hasta {max} caracteres.",
  "calendar.form.issue.event_notes_too_long":
    "Las notas pueden tener hasta {max} caracteres.",
  "calendar.form.issue.event_audience_empty":
    "Elige todo el club o al menos un grupo.",
  "calendar.form.issue.event_audience_foreign_group":
    "Uno de estos grupos ya no existe. Cierra y vuelve a abrir el formulario.",
  "calendar.form.issue.event_in_past": "Esa fecha y esa hora ya pasaron.",
  "calendar.form.issue.series_weekdays_empty":
    "Elige al menos un día de la semana.",
  "calendar.form.issue.series_range_inverted":
    "La fecha de fin va antes que la de inicio.",
  "calendar.form.issue.series_range_too_long":
    "Una serie puede durar como mucho {max} días.",
  "calendar.form.issue.series_without_sessions":
    "Con esos días y esas fechas no sale ninguna sesión. Cambia los días o el rango.",
  "calendar.form.issue.end_time_required": "Indica a qué hora termina.",
  "calendar.form.issue.end_before_start":
    "La hora de fin debe ser después del inicio.",
  "calendar.form.issue.multi_day_series":
    "Una sesión de una serie tiene que terminar el mismo día que empieza.",
  "calendar.form.issue.event_cover_empty": "Esa imagen está vacía. Elige otra.",
  "calendar.form.issue.event_cover_too_large":
    "La imagen puede pesar como mucho {max} MB.",
  "calendar.form.issue.event_cover_type_unsupported":
    "Elige una imagen JPEG, PNG o WebP.",
  "calendar.form.issue.event_cover_upload_invalid":
    "Esa imagen ya no está disponible. Vuelve a elegirla.",
  "calendar.form.error.network":
    "No pudimos hablar con el servidor. Revisa tu conexión y vuelve a intentarlo.",
  "calendar.form.error.signInRequired":
    "Tu sesión terminó. Vuelve a entrar para crear el evento.",
  "calendar.form.error.forbidden": "Tu rol no permite crear eventos.",
  "calendar.form.error.unexpected":
    "No pudimos crear el evento. Vuelve a intentarlo.",
  // Próximos y pasados, y la fila desplegada (#312, RF-7 y RF-8).
  "calendar.period.label": "Qué eventos ver",
  "calendar.period.upcoming": "Próximos",
  "calendar.period.past": "Pasados",
  "calendar.pastTitle": "Eventos pasados",
  "calendar.pastEmpty": "No hay eventos pasados.",
  // Saltar a una fecha en Pasados (#710).
  "calendar.jump.label": "Ir a una fecha",
  "calendar.jump.latest": "Lo más reciente",
  "calendar.jump.empty": "No hay eventos en esa fecha ni antes.",
  "calendar.detail.loading": "Cargando el detalle…",
  "calendar.detail.notes": "Notas",
  "calendar.detail.noNotes": "Este evento no tiene notas.",
  "calendar.detail.responses": "Respuestas",
  "calendar.detail.noResponses": "Todavía no ha respondido nadie.",
  "calendar.detail.going": "Van",
  "calendar.detail.maybe": "Quizás",
  "calendar.detail.nobodyYet": "Nadie todavía.",
  "calendar.detail.audience": "Audiencia",
  "calendar.detail.audience.club": "Todo el club",
  "calendar.detail.audience.noGroups":
    "Sin grupos: solo lo ven Admin y Committee.",
  "calendar.detail.error.notFound":
    "Este evento ya no está disponible. Recarga el calendario.",
  "calendar.detail.error.unexpected":
    "No pudimos cargar este evento. Vuelve a intentarlo.",
  "calendar.panel.repeat.every": "Todos los {days}",
  "calendar.panel.repeat.until": "Hasta el {date} · {sessions}",
  "calendar.panel.repeat.sessionsLeft": {
    one: "queda {count} sesión",
    other: "quedan {count} sesiones",
  },
  "calendar.panel.when": "Cuándo",
  "calendar.panel.repeats": "Se repite",
  "calendar.panel.place": "Dónde",
  "calendar.panel.addToCalendar": "Agregar a mi calendario",
  "calendar.panel.copyAddress": "Copiar dirección",
  "calendar.panel.addressCopied": "Dirección copiada",
  "calendar.panel.copyFailed": "No se pudo copiar",
  "calendar.panel.directions": "Cómo llegar",
  "calendar.panel.mapTitle": "Mapa de {place}",
  "calendar.panel.mapAttribution": "© colaboradores de OpenStreetMap",
  "calendar.panel.opensNewTab": "(se abre en una pestaña nueva)",
  "calendar.panel.rsvpHeading": "¿Vas?",
  "calendar.panel.goingHeading": "Van · {count}",
  "calendar.panel.moreGoing": "+{count} más",
  "calendar.panel.seeAll": "Ver todos",
  "calendar.panel.backToList": "Volver a la lista",
  "calendar.mobile.title": "Calendario",
  "calendar.mobile.create": "Nuevo evento",
  "calendar.screen.back": "Volver al calendario",
  "calendar.screen.more": "Acciones del evento",
  "calendar.screen.sheet.repeats": "Este evento se repite",
  "calendar.screen.sheet.editSession": "Editar solo esta sesión",
  "calendar.screen.sheet.editFollowing": "Editar esta y las siguientes",
  "calendar.screen.sheet.editFollowingHint": "Todas las sesiones desde esta",
  "calendar.screen.sheet.editEvent": "Editar evento",
  "calendar.screen.sheet.cancelEvent": "Cancelar evento",
  "calendar.screen.sheet.close": "Cerrar",
  "calendar.screen.sheet.grip": "Cerrar acciones",
  "calendar.teams.heading": "Equipos",
  "calendar.teams.playingIn":
    "Juegas en {team}, de color {color}, como {position}.",
  "calendar.teams.playingInWithoutPosition":
    "Juegas en {team}, de color {color}, sin posición.",
  "calendar.teams.playingInEyebrow": "Juegas en",
  "calendar.teams.positionAndColor": "{position} · Color: {color}",
  "calendar.teams.noPosition": "Sin posición",
  "calendar.teams.notAssigned":
    "No estás en ninguno de los equipos de este evento.",
  "calendar.teams.noPlayers": "Este equipo todavía no tiene jugadores.",
  "calendar.teams.error": "No pudimos cargar los equipos.",
  "calendar.teams.retry": "Volver a cargar los equipos",
  "calendar.teams.color.red": "rojo",
  "calendar.teams.color.orange": "naranja",
  "calendar.teams.color.gold": "dorado",
  "calendar.teams.color.yellow": "amarillo",
  "calendar.teams.color.green": "verde",
  "calendar.teams.color.teal": "turquesa",
  "calendar.teams.color.blue": "azul",
  "calendar.teams.color.navy": "azul marino",
  "calendar.teams.color.purple": "morado",
  "calendar.teams.color.pink": "rosa",
  "calendar.teams.color.black": "negro",
  "calendar.teams.color.white": "blanco",
  "calendar.teams.color.grey": "gris",
  "notifications.generic.title": "Aviso nuevo",
  "notifications.generic.body": "Algo cambió en tu cuenta.",
  "themeToggle.switchToLight": "Cambiar a tema claro",
  "themeToggle.switchToDark": "Cambiar a tema oscuro",
  "languageToggle.label": "Idioma: español. Cambiar a English (EN)",
  "languageToggle.target": "EN",

  "email.signature": "{clubName}, club de rugby subacuático de Melbourne.",
  "email.directory.signature": "Te escribe {name}, {role} de {clubName}.",
  "email.recovery.subject": "Recupera tu contraseña de {clubName}",
  "email.recovery.requested":
    "Alguien pidió cambiar la contraseña de tu cuenta de {clubName}.",
  "email.recovery.linkLifetime": {
    one: "El enlace sirve una sola vez y caduca en {count} minuto.",
    other: "El enlace sirve una sola vez y caduca en {count} minutos.",
  },
  "email.recovery.button": "Elegir contraseña nueva",
  "email.recovery.linkLabel":
    "Para elegir una contraseña nueva, abre este enlace",
  "email.recovery.notYou":
    "Si no lo pediste tú, ignora este correo: tu contraseña no cambia.",
  "email.confirmation.subject": "Confirma tu correo en {clubName}",
  "email.confirmation.registered":
    "Te registraste en {clubName} con esta dirección.",
  "email.confirmation.linkLifetime": {
    one: "El enlace caduca en {count} minuto.",
    other: "El enlace caduca en {count} minutos.",
  },
  "email.confirmation.ifExpired":
    "Si caduca, pide otro con el botón «{resendButton}» de la pantalla de confirmación. Si ya la cerraste, empieza el registro otra vez con esta dirección y volverás a esa pantalla.",
  "email.confirmation.button": "Confirmar mi correo",
  "email.confirmation.linkLabel": "Para confirmar tu correo, abre este enlace",
  "email.confirmation.notYou":
    "Si no te registraste tú, ignora este correo: sin confirmar, la cuenta no se activa.",
  "email.invitation.subject": "Te invitaron a {clubName}",
  "email.invitation.invited":
    "El club te invitó a {clubName} con esta dirección.",
  "email.invitation.nextSteps":
    "Para activar tu cuenta, abre el enlace, elige una contraseña y entra con ella. Después completa tu registro con los datos que falten.",
  "email.invitation.linkLifetime": {
    one: "El enlace sirve una sola vez y caduca en {count} minuto.",
    other: "El enlace sirve una sola vez y caduca en {count} minutos.",
  },
  "email.invitation.button": "Activar mi cuenta",
  "email.invitation.linkLabel": "Para activar tu cuenta, abre este enlace",
  "email.invitation.ifExpired":
    "Si caduca, pide al club que te reenvíe la invitación.",
  "email.invitation.notYou":
    "Si no esperabas esta invitación, ignora este correo: sin activarla, la cuenta no se usa.",
  "email.renewal.subject": "Tu membresía de {clubName} se renueva el {date}",
  "email.renewal.changeBefore":
    "Si quieres cambiar la tarjeta o el plan, hazlo en Pagos antes de esa fecha.",
  "email.renewal.button": "Ir a Pagos",
  "email.renewal.linkLabel": "Para ver tus pagos, abre este enlace",
  // La configuración del club (#296, RF-6 del PRD de E18a), sólo del Admin.
  "clubSettings.metaTitle": "Configuración del club · {club}",
  "clubSettings.metaDescription":
    "El nombre, las iniciales, el color de acento y el logo del club, tal como los ven los miembros en cada pantalla.",
  "clubSettings.title": "Configuración del club",
  "clubSettings.lead": "Lo que ven los miembros y cómo está montado el club.",
  "clubSettings.loading": "Cargando la configuración del club…",
  "clubSettings.sections.label": "Secciones de la configuración",
  "clubSettings.sections.general": "General",
  "clubSettings.sections.sign-in": "Página de inicio de sesión",
  "clubSettings.sections.positions": "Posiciones",
  "clubSettings.sections.packs": "Packs de sesiones",
  "clubSettings.list.adminsOnly": "Solo los Admin ven esto.",
  "clubSettings.list.backToAccount": "Volver a Mi cuenta",
  "clubSettings.list.backToList": "Configuración",
  "clubSettings.draft.unsaved.general":
    "Cambios sin guardar en los datos del club",
  "clubSettings.draft.unsaved.sign-in":
    "Cambios sin guardar en la página de inicio de sesión",
  "clubSettings.draft.unsaved.packs": "Cambios sin guardar en los packs",
  "clubSettings.draft.discard": "Descartar",
  "clubSettings.draft.save": "Guardar cambios",
  "clubSettings.draft.saving": "Guardando…",
  "clubSettings.draft.saved": "Guardado",
  "clubSettings.draft.marker": "Sin guardar",
  "clubSettings.draft.leaveQuestion": "¿Salir sin guardar?",
  "clubSettings.summary.general.name": "Nombre",
  "clubSettings.summary.general.initials": "iniciales",
  "clubSettings.summary.general.colour": "color {colour}",
  "clubSettings.summary.general.logo": "logo",
  "clubSettings.summary.signIn.entry": "{language}: {source}",
  "clubSettings.summary.signIn.english": "Inglés",
  "clubSettings.summary.signIn.spanish": "Español",
  "clubSettings.summary.signIn.appText": "texto de la app",
  "clubSettings.summary.signIn.custom": "propio",
  "clubSettings.summary.positions.active": {
    one: "{count} posición",
    other: "{count} posiciones",
  },
  "clubSettings.summary.positions.archived": {
    one: "{count} archivada",
    other: "{count} archivadas",
  },
  "clubSettings.summary.packs.none": "Sin packs",
  "clubSettings.summary.packs.count": {
    one: "{count} pack",
    other: "{count} packs",
  },
  "clubSettings.summary.packs.sessions": {
    one: "{sizes} sesión",
    other: "{sizes} sesiones",
  },
  "clubSettings.identity.title": "Identidad",
  "clubSettings.name.label": "Nombre del club",
  "clubSettings.name.counter": "{count} / {max}",
  "clubSettings.initials.label": "Iniciales",
  "clubSettings.initials.optional": "opcional",
  "clubSettings.initials.hint":
    "Se ven cuando no hay logo. Hasta {max} letras.",
  "clubSettings.season.title": "Temporada",
  "clubSettings.season.label": "Inicio de temporada",
  "clubSettings.season.hint":
    "La asistencia del inicio cuenta desde aquí. Vacío: desde el 1 de enero.",
  "clubSettings.brand.title": "Marca",
  "clubSettings.accent.label": "Color de acento",
  "clubSettings.accent.suggested": "Colores sugeridos",
  "clubSettings.accent.picker":
    "Elegir el color de acento en pantalla (ahora {color})",
  "clubSettings.preview.title": "Vista previa",
  "clubSettings.preview.button": "Botón principal",
  "clubSettings.preview.textWith": "Texto con",
  "clubSettings.preview.link": "un enlace",
  "clubSettings.preview.note":
    "La app comprueba que el color se lea bien en claro y en oscuro.",
  "clubSettings.logo.label": "Logo",
  "clubSettings.logo.none": "Sin logo todavía",
  "clubSettings.logo.present": "Logo en uso",
  "clubSettings.logo.add": "Subir",
  "clubSettings.logo.change": "Cambiar",
  "clubSettings.logo.remove": "Quitar",
  "clubSettings.logo.choose": "Elegir un logo",
  "clubSettings.logo.hint":
    "PNG o WebP, cuadrado, de al menos 256 px y hasta {max} KB. Se guarda al momento.",
  "clubSettings.logo.uploading": "Subiendo…",
  "clubSettings.logo.removing": "Quitando…",
  "clubSettings.logo.saved": "Logo actualizado.",
  "clubSettings.logo.removed": "Logo quitado: vuelven las iniciales.",
  "clubSettings.logo.issue.logoEmpty":
    "Este archivo está vacío. Elige otro logo.",
  "clubSettings.logo.issue.logoTooLarge":
    "Este logo pesa más de {max} KB. Elige uno más pequeño.",
  "clubSettings.logo.issue.logoTypeUnsupported": "Sólo valen logos PNG o WebP.",
  "clubSettings.logo.issue.logoUndecodable":
    "Este archivo no se puede leer como imagen. Elige otro logo.",
  "club.logoAlt": "Logo de {club}",
  "clubSettings.reloadLatest": "Cargar la configuración más reciente",
  "clubSettings.issue.nameRequired": "El club necesita un nombre.",
  "clubSettings.issue.nameTooLong":
    "El nombre puede tener como mucho {max} caracteres.",
  "clubSettings.issue.initialsTooLong":
    "Las iniciales pueden tener como mucho {max} caracteres.",
  "clubSettings.issue.accentInvalid": "Usa un código como #33A1E0.",
  "clubSettings.issue.accentNoReadableText":
    "Ningún color de texto llega al contraste mínimo (4,5:1) sobre este acento. Elige uno más claro o más oscuro.",
  "clubSettings.issue.seasonStartInvalid": "Elige una fecha que exista.",
  "clubSettings.error.changed":
    "Otro Admin cambió la configuración mientras la editabas. Carga la más reciente y vuelve a hacer tu cambio.",
  "clubSettings.error.signInRequired":
    "Tu sesión terminó. Vuelve a entrar para seguir.",
  "clubSettings.error.forbidden":
    "Sólo un Admin puede cambiar la configuración del club.",
  "clubSettings.error.unexpected":
    "Algo falló con la configuración del club. Vuelve a intentarlo.",
  "clubSettings.signInTexts.title": "Pantalla de entrar",
  "clubSettings.signInTexts.lead":
    "El titular y el párrafo de la página de inicio de sesión. Deja un campo vacío para usar el texto de la app.",
  "clubSettings.signInTexts.loading": "Cargando los textos de entrada…",
  "clubSettings.signInTexts.language": "Idioma de los textos",
  "clubSettings.signInTexts.language.en": "Inglés",
  "clubSettings.signInTexts.language.es": "Español",
  "clubSettings.signInTexts.tagline": "Titular",
  "clubSettings.signInTexts.welcome": "Párrafo de bienvenida",
  "clubSettings.signInTexts.counter": "{count} / {max}",
  "clubSettings.signInTexts.otherLanguage.own":
    "{language} tiene su propio texto.",
  "clubSettings.signInTexts.otherLanguage.app":
    "{language} usa el texto de la app.",
  "clubSettings.signInTexts.otherLanguage.tooLong":
    "{language} tiene un texto por encima del límite.",
  "clubSettings.signInTexts.preview": "Página de inicio de sesión · {code}",
  "clubSettings.signInTexts.issue.taglineTooLong":
    "El titular puede tener como mucho {max} caracteres.",
  "clubSettings.signInTexts.issue.welcomeTooLong":
    "El párrafo de bienvenida puede tener como mucho {max} caracteres.",
  "clubSettings.sessionPacks.title": "Packs de sesiones",
  "clubSettings.sessionPacks.lead":
    "Paquetes que pueden comprar los miembros Casual. Cada pack cuesta el precio de la sesión Casual × sesiones (ahora {price} por sesión en Stripe).",
  "clubSettings.sessionPacks.lead.noPrice":
    "Paquetes que pueden comprar los miembros Casual. Cada pack cuesta el precio de la sesión Casual × sesiones.",
  "clubSettings.sessionPacks.loading": "Cargando los packs de sesiones…",
  "clubSettings.reorder.pickedUp":
    "Has cogido {item}, puesto {rank} de {total}.",
  "clubSettings.reorder.over":
    "Llevas {item} sobre el puesto {rank} de {total}.",
  "clubSettings.reorder.outside": "Llevas {item} fuera de la lista.",
  "clubSettings.reorder.dropped":
    "Has soltado {item} en el puesto {rank} de {total}.",
  "clubSettings.reorder.droppedInPlace":
    "Has soltado {item} en su puesto, el {rank} de {total}.",
  "clubSettings.reorder.cancelled":
    "Movimiento cancelado: {item} sigue en el puesto {rank} de {total}.",
  "clubSettings.sessionPacks.dragItem": "el pack de {pack}",
  "clubSettings.sessionPacks.pack": {
    one: "{count} sesión",
    other: "{count} sesiones",
  },
  "clubSettings.sessionPacks.empty":
    "Sin packs. Los miembros Casual solo pueden pagar por sesión.",
  "clubSettings.sessionPacks.handle":
    "Reordenar el pack de {pack}, puesto {rank} de {total}",
  "clubSettings.sessionPacks.remove.label": "Quitar el pack de {pack}",
  "clubSettings.sessionPacks.add.label": "Sesiones del pack nuevo",
  "clubSettings.sessionPacks.add.placeholder": "Sesiones",
  "clubSettings.sessionPacks.add.unit": "sesiones",
  "clubSettings.sessionPacks.add.submit": "Añadir",
  "clubSettings.sessionPacks.add.issue.outOfRange": "Entre {min} y {max}.",
  "clubSettings.sessionPacks.add.issue.repeated": "Ya está en la lista.",
  "clubSettings.sessionPacks.footer":
    "De {min} a {max} sesiones, sin repetir. Los miembros los ven en este orden.",
  "clubSettings.sessionPacks.moved":
    "El pack de {pack} es ahora el {rank} de {total}.",
  "clubSettings.sessionPacks.added":
    "Pack de {pack} añadido. Guarda para ofrecerlo.",
  "clubSettings.sessionPacks.removed":
    "Pack de {pack} quitado. Guarda para dejar de ofrecerlo.",
  "clubSettings.sessionPacks.issue.required": "Deja al menos un pack.",
  "clubSettings.sessionPacks.issue.outOfRange":
    "Un pack tiene de {min} a {max} sesiones.",
  "clubSettings.sessionPacks.issue.repeated":
    "Ya hay un pack con esas sesiones.",
  "clubSettings.sessionPacks.error.forbidden":
    "Solo un Admin o alguien del Committee puede cambiar los packs de sesiones.",
  "clubSettings.positions.title": "Posiciones",
  "clubSettings.positions.lead":
    "El orden de aquí es el orden en todas partes: filtros del directorio, equipos y evaluaciones. El rol le dice al reparto automático dónde juega cada posición.",
  "clubSettings.positions.loading": "Cargando las posiciones…",
  "clubSettings.positions.column.position": "Posición",
  "clubSettings.positions.column.coverage": "Rol en el reparto",
  "clubSettings.positions.handle.label":
    "Reordenar {name}, puesto {rank} de {total}",
  "clubSettings.reorder.hint":
    "Arrastra o usa las flechas arriba y abajo para mover.",
  "clubSettings.positions.languageCode.en": "EN",
  "clubSettings.positions.languageCode.es": "ES",
  "clubSettings.positions.name.placeholder.en": "Inglés",
  "clubSettings.positions.name.placeholder.es": "Español",
  "clubSettings.positions.create.placeholder": "Nueva posición (inglés)",
  "clubSettings.positions.create.hint": "Con un nombre basta.",
  "clubSettings.positions.archived.toggle": "Archivadas · {total}",
  "clubSettings.positions.archived.note":
    "ocultas en los registros nuevos y guardadas en los viejos",
  "clubSettings.positions.archived.toggle.label":
    "Archivadas · {total}, ocultas en los registros nuevos y guardadas en los viejos",
  "clubSettings.positions.savedNotice": "{change} · guardado",
  "clubSettings.positions.active.title": "Posiciones activas",
  "clubSettings.positions.active.empty":
    "No hay posiciones activas. Añade una abajo o reactiva una archivada.",
  "clubSettings.positions.archived.title": "Posiciones archivadas",
  "clubSettings.positions.create.title": "Añadir una posición",
  "clubSettings.positions.create.submit": "Añadir",
  "clubSettings.positions.create.saving": "Añadiendo…",
  "clubSettings.positions.rename.label": "Renombrar {name}",
  "clubSettings.positions.rename.submit": "Guardar nombre",
  "clubSettings.positions.cancel": "Cancelar",
  "clubSettings.positions.name.en": "Nombre en inglés",
  "clubSettings.positions.name.es": "Nombre en español",
  "clubSettings.positions.language.en": "inglés",
  "clubSettings.positions.language.es": "español",
  "clubSettings.positions.otherName": "{language} · {name}",
  "clubSettings.positions.missingName": "Sin nombre en {language}",
  "clubSettings.positions.rename": "Renombrar",
  "clubSettings.positions.archive": "Archivar",
  "clubSettings.positions.archive.label": "Archivar {name}",
  "clubSettings.positions.reactivate": "Reactivar",
  "clubSettings.positions.reactivate.label": "Reactivar {name}",
  "clubSettings.positions.moved": "{name} movida al {rank} de {total}",
  "clubSettings.positions.created": "{name} añadida",
  "clubSettings.positions.renamed": "{name} renombrada",
  "clubSettings.positions.archived":
    "{name} archivada: quien la tiene la conserva",
  "clubSettings.positions.reactivated": "{name} se puede volver a elegir",
  // La función de cada posición en el auto-balance (#404). Sólo se ve aquí.
  // Aquí sí va "Portero": es lo que cubre la posición, como pide el ticket.
  "clubSettings.positions.coverage.control.label": "Función de {name}",
  "clubSettings.positions.coverage.none": "Sin función",
  "clubSettings.positions.coverage.goalkeeper": "Portero",
  "clubSettings.positions.coverage.defender": "Defensa",
  "clubSettings.positions.coverage.forward": "Ataque",
  "clubSettings.positions.coverage.saved":
    "{name} ahora cuenta como {coverage}",
  "clubSettings.positions.coverage.cleared":
    "{name} ya no cuenta con ninguna función",
  // El móvil (#724): la lista con su hoja de edición.
  "clubSettings.positions.phone.hint": "Mantén ⋮⋮ y arrastra para reordenar",
  "clubSettings.positions.phone.savedNotice": "✓ Guardado",
  "clubSettings.positions.phone.createPlaceholder": "Nueva posición",
  "clubSettings.positions.sheet.close": "Cerrar la hoja",
  "clubSettings.positions.sheet.name.en": "Inglés",
  "clubSettings.positions.sheet.name.es": "Español",
  "clubSettings.positions.sheet.save": "Guardar",
  "clubSettings.positions.retry": "Volver a intentarlo",
  "clubSettings.positions.reloadLatest": "Cargar las últimas posiciones",
  "clubSettings.positions.issue.nameRequired":
    "Dale a la posición un nombre en al menos un idioma.",
  "clubSettings.positions.issue.nameTooLong": "Hasta {max} caracteres.",
  "clubSettings.positions.issue.nameTaken": "Otra posición ya se llama así.",
  "clubSettings.positions.error.changed":
    "Otro Admin cambió las posiciones mientras las editabas. Carga las últimas y vuelve a intentarlo.",
  // Noticias (#329): el feed y la publicación abierta.
  "news.metaTitle": "Noticias · {club}",
  "news.metaDescription": "Lo que el club ha publicado para ti.",
  "news.eyebrow": "Noticias y documentos",
  "news.title": "Novedades del club",
  "news.loading": "Cargando las noticias…",
  "news.empty": "Todavía no hay nada publicado para ti.",
  "news.loadMore": "Cargar más",
  "news.loadingMore": "Cargando…",
  "news.retry": "Volver a intentarlo",
  "news.featured.pinned": "Fijada",
  "news.featured.pinnedUntil": "Fijada · hasta el {date}",
  "news.latest": "Lo último",
  "news.featured.readPost": "Leer publicación",
  "news.list.earlier": "Anteriores",
  // Fijar y desfijar desde el feed (#595).
  "news.pin.pin": "Fijar",
  "news.pin.unpin": "Desfijar",
  "news.pin.row": "Fijar {title}",
  "news.pin.stripLabel": "Fijar arriba durante",
  "news.pin.duration.oneWeek": "1 semana",
  "news.pin.duration.twoWeeks": "2 semanas",
  "news.pin.duration.fourWeeks": "4 semanas",
  "news.pin.duration.untilUnpinned": "Hasta que la desfije",
  "news.pin.cancel": "Cancelar",
  "news.pin.replaces": "Reemplaza a la que está fijada ahora.",
  "news.pin.error.withdrawn":
    "Esta publicación está retirada y no se puede fijar.",
  "news.pin.error.forbidden":
    "Solo un Admin puede fijar o desfijar publicaciones.",
  "news.pin.error.signInRequired":
    "Tu sesión terminó. Vuelve a entrar para fijar o desfijar publicaciones.",
  "news.pin.error.pinUnexpected":
    "No pudimos fijar esta publicación. Vuelve a intentarlo.",
  "news.pin.error.unpinUnexpected":
    "No pudimos desfijar esta publicación. Vuelve a intentarlo.",
  "news.unread": "Nueva",
  "news.category.announcement": "Aviso",
  "news.category.news": "Noticia",
  "news.category.document": "Documento",
  "news.attachmentCount": {
    one: "{count} adjunto",
    other: "{count} adjuntos",
  },
  "news.error.signInRequired":
    "Tu sesión terminó. Vuelve a entrar para ver las noticias.",
  "news.error.unexpected":
    "No pudimos cargar las noticias. Vuelve a intentarlo.",
  "news.post.back": "← Volver a Noticias",
  "news.post.loading": "Cargando la publicación…",
  "news.post.published": "Publicada el {date}",
  "news.post.edited": "Editada el {date}",
  "news.post.withdrawn": "Retirada",
  "news.post.attachments": "Adjuntos",
  "news.post.download": "Descargar",
  "news.post.audience.club": "Para todo el club",
  "news.post.audience.groups": "Para {groups}",
  "news.post.fileKind.pdf": "PDF",
  "news.post.fileKind.image": "Imagen",
  "news.post.fileKind.word": "Documento de Word",
  "news.post.fileKind.other": "Archivo",
  "news.post.unavailable": "{name} ya no está disponible.",
  "news.post.notFound.title": "Esta publicación no existe",
  "news.post.notFound.lead": "Revisa la dirección o vuelve a Noticias.",
  "news.post.error.unexpected":
    "No pudimos abrir la publicación. Vuelve a intentarlo.",
  // El formulario de publicar (#330).
  "news.publish": "+ Publicar",
  // El nombre del enlace de publicar (#600): en el móvil es sólo el icono "+".
  "news.publishName": "Publicar",
  "news.publish.metaTitle": "Publicar · {club}",
  "news.publish.metaDescription":
    "Escribe una publicación para el club, elige quién la ve y adjunta documentos.",
  "news.publish.back": "← Volver a Noticias",
  "news.publish.title": "Nueva publicación",
  "news.publish.lead":
    "Escríbela, elige quién la ve y adjunta los documentos que hagan falta. Sale arriba del feed en cuanto la publicas.",
  "news.publish.loading": "Cargando los grupos del club…",
  "news.publish.loadFailed":
    "No pudimos cargar el formulario. Vuelve a intentarlo.",
  "news.publish.category": "Categoría",
  "news.publish.titleLabel": "Título",
  "news.publish.body": "Mensaje",
  "news.publish.bodyHint":
    "Admite Markdown · {modifier}B negrita · {modifier}I cursiva",
  "news.publish.editor.tabs": "Vista del mensaje",
  "news.publish.editor.write": "Escribir",
  "news.publish.editor.preview": "Vista previa",
  "news.publish.editor.previewEmpty": "Todavía no hay nada que previsualizar.",
  "news.publish.editor.toolbar": "Formato",
  "news.publish.editor.format.bold": "Negrita",
  "news.publish.editor.format.italic": "Cursiva",
  "news.publish.editor.format.heading": "Encabezado",
  "news.publish.editor.format.bulletList": "Lista",
  "news.publish.editor.format.numberedList": "Lista numerada",
  "news.publish.editor.format.quote": "Cita",
  "news.publish.editor.format.link": "Enlace",
  "news.publish.editor.image": "Insertar imagen",
  "news.publish.editor.imageUploading": "Subiendo la imagen…",
  "news.publish.editor.chooseImage": "Elige una imagen",
  "news.publish.editor.image.issue.uploadFailed":
    "No pudimos subir la imagen. Revisa tu conexión y vuelve a intentarlo.",
  "news.publish.editor.image.issue.empty": "La imagen está vacía.",
  "news.publish.editor.image.issue.tooLarge":
    "Cada imagen puede pesar hasta {max} MB.",
  "news.publish.editor.image.issue.typeUnsupported":
    "La imagen tiene que ser JPEG, PNG o WebP.",
  "news.publish.editor.help": "Ayuda de formato",
  "news.publish.editor.help.bold": "**texto en negrita**",
  "news.publish.editor.help.italic": "*texto en cursiva*",
  "news.publish.editor.help.heading": "## Encabezado",
  "news.publish.editor.help.bulletList": "- Elemento",
  "news.publish.editor.help.numberedList": "1. Elemento",
  "news.publish.editor.help.quote": "> Cita",
  "news.publish.editor.help.link": "[texto del enlace](https://…)",
  "news.publish.audience.legend": "Quién la ve",
  "audience.club": "Todo el club",
  "audience.groups": "Grupos concretos",
  "audience.groupsLegend": "Grupos",
  "audience.noGroups":
    "El club todavía no tiene grupos, así que sólo puede ir a todo el club.",
  "news.publish.attachments.legend": "Adjuntos",
  "news.publish.attachments.hint":
    "Hasta {max} archivos de {size} MB cada uno: PDF, JPEG, PNG, WebP o Word.",
  "news.publish.attachments.choose": "Elegir archivos",
  "news.publish.attachments.add": "Añadir archivos",
  "news.publish.attachments.uploading": "Subiendo…",
  "news.publish.attachments.remove": "Quitar",
  "news.publish.attachments.removeNamed": "Quitar {name}",
  "news.publish.attachments.notice": "{name}: {reason}",
  "news.publish.attachments.removeFailed":
    "No pudimos quitarlo. Vuelve a intentarlo.",
  "news.publish.attachments.issue.empty": "El archivo está vacío.",
  "news.publish.attachments.issue.tooLarge":
    "Cada archivo puede pesar hasta {max} MB.",
  "news.publish.attachments.issue.typeUnsupported":
    "Sólo PDF, imágenes (JPEG, PNG, WebP) y documentos de Word.",
  "news.publish.attachments.issue.typeMismatch":
    "La extensión del archivo no corresponde con lo que tiene dentro.",
  "news.publish.attachments.issue.nameInvalid":
    "El nombre del archivo no vale. Cámbialo y vuelve a intentarlo.",
  "news.publish.attachments.issue.limitReached":
    "Una publicación puede llevar como mucho {max} adjuntos.",
  "news.publish.attachments.issue.uploadMissing":
    "Un adjunto ya no está subido. Quítalo y vuelve a adjuntarlo.",
  "news.publish.titleCounter": "{length} / {max}",
  // La caja de fijar del formulario, solo para el Admin (#599).
  "news.publish.pin.label": "Fijar arriba del feed",
  "news.publish.pin.hint":
    "Se queda como destacada. Lo demás va de la más nueva a la más antigua.",
  "news.publish.pin.unpinsOn": "Se desfija sola el {date}.",
  "news.publish.pin.staysUntilUnpinned": "Se queda hasta que la desfijes.",
  "news.publish.pin.replaces":
    "Reemplaza a la que está fijada ahora: “{title}”",
  "news.publish.cover.legend": "Portada",
  "news.publish.cover.optional": "opcional",
  "news.publish.cover.empty": "Sin portada",
  "news.publish.cover.fallback": "Se usa el fondo de {category}.",
  "news.publish.cover.add": "Añadir portada",
  "news.publish.cover.choose": "Elegir una portada",
  "news.publish.cover.preview": "Portada",
  "news.publish.cover.hint":
    "Se muestra en el feed y arriba de la publicación. Mejor en horizontal.",
  "news.publish.cover.remove": "Quitar portada",
  "news.published.notice": "Publicada · avisamos a {audience}",
  "news.published.pinnedNotice": "Publicada y fijada · avisamos a {audience}",
  "news.published.pinnedUntilNotice":
    "Publicada y fijada hasta el {date} · avisamos a {audience}",
  "news.published.audience.club": "todo el club",
  "news.publish.cover.issue.empty": "La portada está vacía.",
  "news.publish.cover.issue.tooLarge": "La portada puede pesar hasta {max} MB.",
  "news.publish.cover.issue.typeUnsupported":
    "La portada tiene que ser una imagen JPEG, PNG o WebP.",
  "news.publish.cover.issue.uploadMissing":
    "La portada ya no está subida. Quítala y vuelve a añadirla.",
  "news.publish.issue.titleMissing": "Ponle un título.",
  "news.publish.issue.titleTooLong":
    "El título puede tener hasta {max} caracteres.",
  "news.publish.issue.bodyMissing": "Escribe el mensaje.",
  "news.publish.issue.audienceGroupsEmpty":
    "Elige al menos un grupo, o mándala a todo el club.",
  "news.publish.submit": "Publicar",
  "news.publish.sending": "Publicando…",
  "news.publish.done": "✓ Publicada",
  "news.publish.bar.cancel": "Cancelar",
  "news.publish.bar.discardQuestion":
    "Tienes cambios sin guardar. ¿Salir y descartarlos?",
  "news.publish.waitForUploads": "Espera a que terminen las subidas.",
  "news.publish.error.network":
    "No pudimos llegar al servidor. No se publicó nada: revisa tu conexión y vuelve a intentarlo.",
  "news.publish.error.signInRequired":
    "Tu sesión terminó. Vuelve a entrar para publicar.",
  "news.publish.error.forbidden": "Tu rol no puede publicar noticias.",
  "news.publish.error.unexpected":
    "No pudimos publicarla. Vuelve a intentarlo.",
  "evaluations.metaTitle": "Evaluaciones · {club}",
  "evaluations.title": "Evaluaciones",
  "evaluations.lead":
    "Las valoraciones de cada miembro y su OVR. Solo las ven el personal de entrenamiento y la administración.",
  "evaluations.loading": "Cargando las evaluaciones del club…",
  "evaluations.retry": "Volver a intentarlo",
  "evaluations.list.title": "Miembros",
  "evaluations.search.label": "Buscar por nombre",
  "evaluations.search.placeholder": "Nombre del miembro",
  "evaluations.list.empty": "Todavía no hay nadie en el club a quien evaluar.",
  "evaluations.list.noMatches": "Ningún miembro coincide con ese nombre.",
  "evaluations.list.notEvaluated": "Sin evaluar",
  "evaluations.notEvaluatedYet": "Todavía no hay evaluación.",
  "evaluations.list.noRatings": "Sin valoraciones",
  "evaluations.list.overall": "OVR {rating}",
  "evaluations.sheet.label": "Evaluación de {name}",
  "evaluations.sheet.eyebrow": "Evaluación del jugador",
  "evaluations.sheet.back": "Todos los miembros",
  "evaluations.sheet.placeholder":
    "Elige a un miembro de la lista para ver su evaluación.",
  "evaluations.sheet.loading": "Cargando la evaluación…",
  "evaluations.overall.title": "Valoración global",
  "evaluations.overall.outOf": "/ {max}",
  "evaluations.overall.noData": "Sin datos",
  "evaluations.ratings.title": "Valoraciones",
  "evaluations.ratings.outOf": " de {max}",
  "evaluations.ratings.retired": "Retirada",
  "evaluations.notEvaluated.title": "{name} todavía no tiene evaluación.",
  "evaluations.notEvaluated.hint":
    "Al crearla, todas las categorías empiezan en 5.",
  "evaluations.create": "Crear evaluación",
  "evaluations.creating": "Creando…",
  "evaluations.edit": "Editar valoraciones",
  "evaluations.save": "Guardar valoraciones",
  "evaluations.saving": "Guardando…",
  "evaluations.cancel": "Cancelar",
  "evaluations.saved": "Valoraciones guardadas.",
  "evaluations.reload": "Recargar la evaluación",
  "evaluations.error.changed":
    "Alguien más cambió esta evaluación mientras la editabas. Recárgala para ver sus cambios.",
  "evaluations.error.exists":
    "Alguien más acaba de crear esta evaluación. Recárgala para verla.",
  "evaluations.error.memberNotFound": "Ese miembro ya no está en el club.",
  "evaluations.error.memberInactive":
    "Ese miembro tiene la cuenta desactivada, así que no se le puede evaluar.",
  "evaluations.error.noActiveCategories":
    "El club no tiene ninguna categoría activa. Añade o reactiva una antes de evaluar.",
  "evaluations.error.signInRequired":
    "Tu sesión terminó. Vuelve a entrar para ver las evaluaciones.",
  "evaluations.error.forbidden":
    "Solo el personal de entrenamiento y la administración ven las evaluaciones.",
  "evaluations.error.unexpected": "Algo salió mal. Vuelve a intentarlo.",
  "evaluations.refresh.hint":
    "Las categorías del club cambiaron desde que se hizo esta evaluación.",
  "evaluations.refresh.action": "Poner al día con las categorías actuales",
  "evaluations.refresh.running": "Poniendo al día…",
  "evaluations.refresh.done": "Esta evaluación ya usa las categorías actuales.",
  "evaluations.categories.link": "Categorías",
  "evaluations.categories.metaTitle": "Categorías de evaluación · {club}",
  "evaluations.categories.title": "Categorías de evaluación",
  "evaluations.categories.lead":
    "Lo que mide cada evaluación, en el orden en que se enseña. Las evaluaciones guardadas conservan sus categorías hasta que las pongas al día.",
  "evaluations.categories.back": "Evaluaciones",
  "evaluations.categories.loading": "Cargando las categorías…",
  "evaluations.categories.active.title": "Categorías activas",
  "evaluations.categories.active.empty":
    "No hay categorías activas. Las evaluaciones nuevas necesitan al menos una.",
  "evaluations.categories.inactive.title": "Categorías desactivadas",
  "evaluations.categories.inactive.empty": "No hay categorías desactivadas.",
  "evaluations.categories.create.title": "Añadir una categoría",
  "evaluations.categories.create.submit": "Añadir categoría",
  "evaluations.categories.create.saving": "Añadiendo…",
  "evaluations.categories.name.label": "Nombre de la categoría",
  "evaluations.categories.name.hint": "Hasta {max} caracteres.",
  "evaluations.categories.rename": "Renombrar",
  "evaluations.categories.rename.label": "Renombrar {name}",
  "evaluations.categories.rename.submit": "Guardar nombre",
  "evaluations.categories.rename.saving": "Guardando…",
  "evaluations.categories.cancel": "Cancelar",
  "evaluations.categories.move.up": "Subir",
  "evaluations.categories.move.up.label": "Subir {name}",
  "evaluations.categories.move.down": "Bajar",
  "evaluations.categories.move.down.label": "Bajar {name}",
  "evaluations.categories.deactivate": "Desactivar",
  "evaluations.categories.deactivate.label": "Desactivar {name}",
  "evaluations.categories.reactivate": "Reactivar",
  "evaluations.categories.reactivate.label": "Reactivar {name}",
  "evaluations.categories.moved":
    "{name} queda en el puesto {rank} de {total}.",
  "evaluations.categories.created": "{name} añadida.",
  "evaluations.categories.renamed": "Nombre guardado.",
  "evaluations.categories.deactivated":
    "{name} está desactivada. Las evaluaciones nuevas no la incluyen.",
  "evaluations.categories.reactivated":
    "{name} vuelve a estar activa. Las evaluaciones nuevas la incluyen.",
  "evaluations.categories.retry": "Volver a intentarlo",
  "evaluations.categories.reloadLatest": "Cargar las últimas categorías",
  "evaluations.categories.issue.nameRequired":
    "Escribe un nombre para la categoría.",
  "evaluations.categories.issue.nameTooLong": "Hasta {max} caracteres.",
  "evaluations.categories.issue.nameTaken":
    "Ya hay otra categoría con este nombre.",
  "evaluations.categories.error.changed":
    "Alguien más cambió las categorías entretanto. Carga las últimas y vuelve a intentarlo.",
  "evaluations.categories.error.notFound":
    "Esa categoría ya no existe. Carga las últimas categorías.",
  "news.post.edit": "Editar",
  "news.post.withdraw": "Retirar",
  "news.post.withdrawQuestion":
    "¿Retirar esta publicación? Desaparece del feed de todos y sus adjuntos dejan de estar disponibles. No se borra: puedes volver a publicarla más tarde.",
  "news.post.withdrawConfirm": "Retirar publicación",
  "news.post.withdrawing": "Retirando…",
  "news.post.cancel": "Cancelar",
  "news.post.republish": "Volver a publicar",
  "news.post.republishing": "Publicando…",
  "news.post.error.withdraw": "No pudimos retirarla. Vuelve a intentarlo.",
  "news.post.error.republish":
    "No pudimos volver a publicarla. Vuelve a intentarlo.",
  // La barra y la hoja ⋯ de la publicación en el móvil (#601).
  "news.post.bar": "Publicación",
  "news.post.bar.back": "Volver a Noticias",
  "news.post.bar.more": "Más acciones",
  "news.post.sheet.title": "Acciones de la publicación",
  "news.post.sheet.close": "Cerrar acciones",
  "news.post.sheet.edit": "Editar publicación",
  "news.post.sheet.pin": "Fijar arriba",
  "news.post.sheet.pinHint": "1, 2 o 4 semanas, o hasta desfijarla",
  "news.post.announce.pinnedUntil": "Fijada hasta el {date}.",
  "news.post.announce.pinned": "Fijada hasta que la desfijes.",
  "news.post.announce.unpinned": "Desfijada.",
  "news.post.announce.withdrawn": "Publicación retirada.",
  "news.post.announce.published": "Publicada otra vez.",
  "news.edit.metaTitle": "Editar publicación · {club}",
  "news.edit.metaDescription": "Corrige una publicación tuya.",
  "news.edit.back": "← Volver a la publicación",
  "news.edit.title": "Editar publicación",
  "news.edit.lead":
    "Guardar no avisa a nadie. La publicación dirá que se editó y cuándo.",
  "news.edit.loading": "Cargando la publicación…",
  "news.edit.loadFailed":
    "No pudimos cargar la publicación. Vuelve a intentarlo.",
  "news.edit.forbidden": "Sólo puedes editar tus propias publicaciones.",
  "news.edit.submit": "Guardar cambios",
  "news.edit.sending": "Guardando…",
  "news.edit.barSubmit": "Guardar",
  "news.edit.done": "✓ Guardada",
  "news.edit.error.conflict":
    "Otra persona guardó esta publicación mientras la editabas. Recarga la página para ver sus cambios antes de guardar los tuyos.",
  "news.edit.error.unexpected":
    "No pudimos guardar los cambios. Vuelve a intentarlo.",
  "attendance.metaTitle": "Asistencia · {club}",
  "attendance.eyebrow": "Asistencia",
  "attendance.title": "{title} · {date}",
  "attendance.loading": "Cargando las sesiones…",
  "attendance.loadingSheet": "Cargando la hoja de asistencia…",
  "attendance.retry": "Reintentar",
  "attendance.sessions.label": "Sesiones",
  "attendance.sessions.choice": "{weekday} {day} · {title}",
  "attendance.noSessions":
    "No ha empezado ningún entrenamiento en los últimos 30 días.",
  "attendance.toCalendar": "Ir al calendario",
  "attendance.olderSessions": "Sesiones anteriores",
  "attendance.olderSessions.label": "Sesiones anteriores: abrir el calendario",
  "attendance.totals.label": "Totales",
  "attendance.group.yes": "Confirmaron",
  "attendance.group.maybe": "Quizás",
  "attendance.group.none": "Sin respuesta",
  "attendance.group.no": "Dijeron que no",
  "attendance.status.present": "Presente",
  "attendance.status.late": "Tarde",
  "attendance.status.absent": "Ausente",
  "attendance.emptySheet": "No se espera a nadie en esta sesión.",
  "attendance.inactive": "Desactivada",
  "attendance.save": "Guardar asistencia",
  "attendance.unsaved": "Cambios sin guardar",
  "attendance.rowUnsaved": "Sin guardar todavía",
  "attendance.saving": "Guardando…",
  "attendance.saved":
    "Asistencia guardada. Presentes: {present}; tarde: {late}; ausentes: {absent}.",
  "attendance.discardQuestion":
    "Hay cambios sin guardar en esta sesión. ¿Los descartas?",
  "attendance.error.notStarted":
    "Este entrenamiento todavía no empezó: la asistencia se pasa desde su hora de inicio.",
  "attendance.error.cancelled":
    "Este entrenamiento está cancelado: no lleva asistencia.",
  "attendance.error.outsideSheet":
    "Alguien de la lista ya no se espera en esta sesión. Recarga la página y vuelve a intentarlo.",
  "attendance.error.notFound": "Esa sesión no existe o no es un entrenamiento.",
  "attendance.error.signInRequired":
    "Tu sesión terminó. Vuelve a entrar para pasar lista.",
  "attendance.error.forbidden": "Sólo Admin y Coach pasan lista.",
  "attendance.error.unexpected": "Algo salió mal. Vuelve a intentarlo.",
  "calendar.takeAttendance": "Pasar lista",
  "teams.metaTitle": "Equipos · {club}",
  "teams.eyebrow": "Armar equipos",
  "teams.lead":
    "El auto-balance reparte la escuadra por puntaje y cuida las posiciones, para que los dos equipos tengan portero, defensas y atacantes de fuerza parecida.",
  "teams.title": "{day} · {title}",
  "teams.loading": "Cargando los eventos…",
  "teams.loadingSquad": "Cargando la escuadra…",
  "teams.retry": "Reintentar",
  "teams.noEvents":
    "No hay entrenamientos ni competiciones por delante para armar equipos.",
  "teams.toCalendar": "Ir al calendario",
  "teams.event.label": "Evento",
  "teams.event.choice": "{day} · {time} · {title}",
  "teams.mode.label": "Modo",
  "teams.mode.manual": "Manual",
  "teams.mode.auto": "Auto-balance",
  "teams.balance": "Balancear equipos",
  "teams.balancing": "Balanceando…",
  "teams.totals.label": "Totales",
  "teams.totals.team": "{team} · {points} pts",
  "teams.totals.difference": "Diferencia {difference}",
  "teams.column.average": "Media {average}",
  "teams.column.players": {
    one: "{count} jugador",
    other: "{count} jugadores",
  },
  "teams.column.empty": "Todavía no hay nadie en este equipo.",
  "teams.available.title": "Disponibles",
  "teams.available.empty": "No queda nadie más que haya dicho Sí.",
  "teams.maybe.title": "Quizás",
  "teams.maybe.empty": "No queda nadie más que haya dicho Quizás.",
  "teams.player.unrated": "Sin evaluar",
  "teams.player.outside": "Ya no viene",
  "teams.move.to": "A {team}",
  "teams.move.toNamed": "Mover a {player} a {team}",
  "teams.move.switch": "Cambiar",
  "teams.move.switchNamed": "Cambiar a {player} a {team}",
  "teams.move.remove": "Quitar",
  "teams.move.removeNamed": "Quitar a {player} de {team}",
  "teams.announce.moved": "{player} pasó a {list}.",
  "teams.announce.removed": "{player} salió de los equipos.",
  "teams.announce.swapped": "{first} y {second} cambiaron de equipo.",
  "teams.announce.totals":
    "{teamA} {pointsA} puntos, {teamB} {pointsB} puntos, diferencia {difference}.",
  "teams.suggestion.title": "Intercambio sugerido",
  "teams.suggestion.coverage":
    "{first} ↔ {second}, para cubrir las posiciones en los dos equipos.",
  "teams.suggestion.rating":
    "{first} ↔ {second}, para bajar la diferencia a {difference}.",
  "teams.suggestion.apply": "Aplicar",
  "teams.save": "Guardar",
  "teams.saving": "Guardando…",
  "teams.unsaved": "Cambios sin guardar",
  "teams.saved":
    "Equipos guardados como borrador. Todavía no se avisó a nadie.",
  "teams.balanced": "Equipos balanceados y guardados como borrador.",
  "teams.publish": "Publicar equipos",
  "teams.publishing": "Publicando…",
  "teams.publishQuestion": {
    one: "¿Publicas los equipos? {count} jugador recibirá un aviso con su equipo.",
    other:
      "¿Publicas los equipos? {count} jugadores recibirán un aviso con su equipo.",
  },
  "teams.republishQuestion": {
    one: "¿Publicas los cambios? De {count} jugador en los equipos, sólo se avisa si entra, sale o cambia de equipo.",
    other:
      "¿Publicas los cambios? De los {count} jugadores en los equipos, sólo reciben aviso quienes entran, salen o cambian de equipo.",
  },
  "teams.publishConfirm": "Publicar y avisar",
  "teams.publishCancel": "Todavía no",
  "teams.published": {
    one: "Equipos publicados. Se avisó a {count} jugador.",
    other: "Equipos publicados. Se avisó a {count} jugadores.",
  },
  "teams.discardQuestion":
    "Hay cambios sin guardar en estos equipos. ¿Los descartas?",
  "teams.error.notBuildable":
    "Sólo los entrenamientos y las competiciones llevan equipos.",
  "teams.error.cancelled":
    "El evento se canceló: sus equipos ya no se pueden cambiar.",
  "teams.error.past": "El evento ya pasó: sus equipos ya no se pueden cambiar.",
  "teams.error.squadEmpty":
    "Nadie ha dicho Sí a este evento: no hay a quién balancear.",
  "teams.error.splitEmpty":
    "Pon al menos a un jugador en un equipo para publicar.",
  "teams.error.outsideSquad":
    "Alguien de los equipos ya no viene. Quita a los marcados “Ya no viene” y vuelve a intentarlo.",
  "teams.error.notFound": "Ese evento no existe.",
  "teams.error.signInRequired":
    "Tu sesión terminó. Vuelve a entrar para armar equipos.",
  "teams.error.forbidden": "Sólo Admin y Coach arman equipos.",
  "teams.error.unexpected": "Algo salió mal. Vuelve a intentarlo.",
  "search.label": "Buscar",
  "search.placeholder": "Buscar miembros, eventos, noticias…",
  "search.results": "Resultados de la búsqueda",
  "search.group.members": "Miembros",
  "search.group.events": "Eventos",
  "search.group.news": "Noticias",
  "search.groupLabel": "{group} ({total})",
  "search.seeAll.members": "Ver todos los miembros",
  "search.seeAll.events": "Ver todos los eventos",
  "search.seeAll.news": "Ver todas las noticias",
  "search.event.cancelled": "Cancelado",
  "search.loading": "Buscando…",
  "search.empty": "Nada coincide con «{text}»",
  "search.error": "No se pudo buscar. Revisa la conexión e inténtalo de nuevo.",
  "search.retry": "Reintentar",
  "search.announcement": {
    one: "{count} resultado",
    other: "{count} resultados",
  },
  "search.open": "Buscar",
  "search.close": "Cerrar la búsqueda",
};
