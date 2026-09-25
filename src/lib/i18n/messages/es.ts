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
  "section.underConstruction": "Esta sección está en construcción.",
  "home.lead":
    "Plataforma del club de rugby subacuático. Esta es la cáscara inicial: el resto de las funcionalidades llega epic por epic, cada una con sus tickets y su revisión.",
  "home.status.title": "Estado del servicio",
  "home.status.body":
    "La API versionada responde en el endpoint de salud, que consulta la base de datos.",
  "signOut.label": "Cerrar sesión",
  "account.link": "Mi cuenta",
  "accountMenu.profile": "Mi perfil",
  "accountMenu.appearance": "Apariencia",
  "accountMenu.language": "Idioma",
  "accountMenu.back": "Volver",
  "accountMenu.clubSettings": "Configuración del club",
  "account.metaTitle": "Perfil · {club}",
  "account.metaDescription":
    "Tus datos, tu rol en el club y tus grupos, y la solicitud para ser Coach o entrar al Comité.",
  "account.roleLine": "Rol: {role}",
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
  "admin.requests.title": "Solicitudes pendientes",
  "admin.requests.empty": "No hay solicitudes esperando respuesta.",
  "admin.requests.asked": "{name} pidió ser {role}",
  "admin.requests.askedOn": "La pidió el {date}",
  "admin.requests.noJustification": "No escribió ninguna nota.",
  "admin.requests.approve": "Aprobar",
  "admin.requests.reject": "Rechazar",
  "admin.requests.approveLabel": "Aprobar la solicitud de {name}",
  "admin.requests.rejectLabel": "Rechazar la solicitud de {name}",
  "admin.requests.approved": "{name} ya es {role}.",
  "admin.requests.rejected": "La solicitud de {name} quedó rechazada.",
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
  "directory.lead":
    "Todo el club. Busca por nombre, filtra por rol y ordena la lista.",
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
  "directory.clearFilters": "Limpiar los filtros",
  "directory.column.member": "Miembro",
  "directory.column.role": "Rol",
  "directory.column.position": "Posición",
  "directory.field.country": "País",
  "directory.field.level": "Nivel",
  "directory.sort.label": "Ordenar por",
  "directory.sort.directionLabel": "Sentido",
  "directory.sort.direction.asc": "Ascendente",
  "directory.sort.direction.desc": "Descendente",
  "directory.mark.inactive": "Desactivada",
  "directory.mark.aufExpired": "AUF vencido",
  // #274: el AUF que escribió el miembro, hasta que un Admin lo verifica.
  "directory.mark.aufNotVerified": "AUF sin verificar",
  "directory.mark.aufVerified": "AUF verificado",
  "directory.mark.pendingActivation": "Pendiente de activar",
  "directory.error.signInRequired":
    "Tu sesión terminó. Vuelve a entrar para ver el directorio.",
  "directory.error.forbidden": "Tu cuenta no puede ver el directorio del club.",
  "directory.error.unexpected":
    "No pudimos cargar el directorio del club. Vuelve a intentarlo.",

  // La ficha reservada al Admin (#242, RF-4 del PRD de E5).
  "memberRecord.metaTitle": "Ficha del miembro · {club}",
  "memberRecord.metaDescription":
    "El registro AUF y los grupos de un miembro, que sólo edita un Admin.",
  "memberRecord.back": "← Volver al directorio",
  "memberRecord.openLabel": "Abrir la ficha de {name}",
  "memberRecord.loading": "Cargando la ficha del miembro…",
  "memberRecord.lead":
    "Lo que sólo edita un Admin: el registro AUF, la fecha de nacimiento y los grupos.",
  "memberRecord.joinedOn": "Miembro desde el {date}",
  "memberRecord.auf.title": "Registro AUF",
  "memberRecord.auf.number": "Número de AUF",
  "memberRecord.auf.expiry": "Vencimiento",
  "memberRecord.auf.hint":
    "Si borras el número, se borra también su vencimiento.",
  "memberRecord.auf.pending":
    "Este AUF lo escribió el miembro. Revísalo y verifícalo, o corrígelo y guarda: lo que escribes tú queda verificado.",
  "memberRecord.auf.verify": "Verificar AUF",
  "memberRecord.auf.verifying": "Verificando…",
  "memberRecord.auf.verified": "AUF verificado.",
  "memberRecord.birth.title": "Datos personales",
  "memberRecord.birth.label": "Fecha de nacimiento",
  "memberRecord.birth.hint":
    "El miembro no puede cambiarla: de ella depende si necesita el consentimiento de un tutor.",
  "memberRecord.birth.guardianNotice":
    "Al guardar, {name} tendrá que dar los datos y el consentimiento de su tutor la próxima vez que entre.",
  "memberRecord.groups.legend": "Grupos",
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
  "directory.aufSummary": "AUF {number} · vence el {date}",
  "directory.aufWithoutExpiry": "AUF {number} · sin vencimiento",
  "directory.aufMissing": "Sin AUF",
  // La invitación de un miembro por un Admin (#243, RF-5 del PRD de E5), abierta
  // desde la cabecera del directorio.
  "directory.addMember": "Invitar miembro",
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
  "notifications.generic.title": "Aviso nuevo",
  "notifications.generic.body": "Algo cambió en tu cuenta.",
  "themeToggle.switchToLight": "Cambiar a tema claro",
  "themeToggle.switchToDark": "Cambiar a tema oscuro",
  "languageToggle.label": "Idioma: español. Cambiar a English (EN)",
  "languageToggle.target": "EN",

  "email.signature": "{clubName}, club de rugby subacuático de Melbourne.",
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
  // La configuración del club (#296, RF-6 del PRD de E18a), sólo del Admin.
  "clubSettings.metaTitle": "Configuración del club · {club}",
  "clubSettings.metaDescription":
    "El nombre, las iniciales, el color de acento y el logo del club, tal como los ven los miembros en cada pantalla.",
  "clubSettings.title": "Configuración del club",
  "clubSettings.lead":
    "Cómo ven el club sus miembros: en la cabecera, al iniciar sesión y en cada correo.",
  "clubSettings.loading": "Cargando la configuración del club…",
  "clubSettings.identity.title": "Nombre e iniciales",
  "clubSettings.name.label": "Nombre del club",
  "clubSettings.name.hint": "Hasta {max} caracteres.",
  "clubSettings.initials.label": "Iniciales",
  "clubSettings.initials.hint":
    "Hasta {max} caracteres. Déjalas vacías para usar las primeras letras del nombre.",
  "clubSettings.brand.title": "Color y logo",
  "clubSettings.accent.label": "Color de acento",
  "clubSettings.accent.hint":
    "Un código hexadecimal, como #1C6EA4. Pégalo de tu guía de marca o elígelo en pantalla.",
  "clubSettings.accent.picker":
    "Elegir el color de acento en pantalla (ahora {color})",
  "clubSettings.accent.previewText": "Texto de ejemplo",
  "clubSettings.accent.previewLink": "Enlace de ejemplo",
  "clubSettings.logo.label": "Logo",
  "clubSettings.logo.none":
    "Todavía no hay logo: en su lugar salen las iniciales.",
  "clubSettings.logo.present": "El club tiene logo.",
  "clubSettings.logo.add": "Subir logo",
  "clubSettings.logo.change": "Cambiar logo",
  "clubSettings.logo.remove": "Quitar logo",
  "clubSettings.logo.choose": "Elegir un logo",
  "clubSettings.logo.hint": "PNG o WebP, hasta {max} KB.",
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
  "clubSettings.save": "Guardar la configuración",
  "clubSettings.saving": "Guardando…",
  "clubSettings.saved": "Configuración guardada.",
  "clubSettings.reloadLatest": "Cargar la configuración más reciente",
  "clubSettings.issue.nameRequired": "El club necesita un nombre.",
  "clubSettings.issue.nameTooLong":
    "El nombre puede tener como mucho {max} caracteres.",
  "clubSettings.issue.initialsTooLong":
    "Las iniciales pueden tener como mucho {max} caracteres.",
  "clubSettings.issue.accentInvalid":
    "El color de acento tiene que ser un código hexadecimal, como #1C6EA4.",
  "clubSettings.issue.accentNoReadableText":
    "Ningún color de texto llega al contraste mínimo (4,5:1) sobre este acento. Elige uno más claro o más oscuro.",
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
    "El lema y el párrafo de bienvenida que se leen antes de iniciar sesión. Deja un campo vacío para que salga el texto de la aplicación en ese idioma.",
  "clubSettings.signInTexts.loading": "Cargando los textos de entrada…",
  "clubSettings.signInTexts.tagline.en": "Lema en inglés",
  "clubSettings.signInTexts.welcome.en": "Párrafo de bienvenida en inglés",
  "clubSettings.signInTexts.tagline.es": "Lema en español",
  "clubSettings.signInTexts.welcome.es": "Párrafo de bienvenida en español",
  "clubSettings.signInTexts.hint": "Hasta {max} caracteres. Texto plano.",
  "clubSettings.signInTexts.issue.taglineTooLong":
    "El lema puede tener como mucho {max} caracteres.",
  "clubSettings.signInTexts.issue.welcomeTooLong":
    "El párrafo de bienvenida puede tener como mucho {max} caracteres.",
  "clubSettings.signInTexts.save": "Guardar los textos",
  "clubSettings.signInTexts.saving": "Guardando los textos…",
  "clubSettings.signInTexts.saved": "Textos de entrada guardados.",
  "clubSettings.positions.title": "Posiciones",
  "clubSettings.positions.lead":
    "Las posiciones de juego que cada miembro elige en su perfil, en el orden que sigue el directorio. Archivar una posición la conserva para quien ya la tiene, pero nadie más puede elegirla.",
  "clubSettings.positions.loading": "Cargando las posiciones…",
  "clubSettings.positions.active.title": "Posiciones activas",
  "clubSettings.positions.active.empty":
    "No hay posiciones activas. Añade una abajo o reactiva una archivada.",
  "clubSettings.positions.archived.title": "Posiciones archivadas",
  "clubSettings.positions.archived.empty": "No hay posiciones archivadas.",
  "clubSettings.positions.create.title": "Añadir una posición",
  "clubSettings.positions.create.submit": "Añadir posición",
  "clubSettings.positions.create.saving": "Añadiendo…",
  "clubSettings.positions.rename.label": "Renombrar {name}",
  "clubSettings.positions.rename.submit": "Guardar nombre",
  "clubSettings.positions.rename.saving": "Guardando…",
  "clubSettings.positions.cancel": "Cancelar",
  "clubSettings.positions.name.en": "Nombre en inglés",
  "clubSettings.positions.name.es": "Nombre en español",
  "clubSettings.positions.name.hint":
    "Hasta {max} caracteres cada uno. Basta con un idioma: donde falte un nombre, se muestra el otro.",
  "clubSettings.positions.language.en": "inglés",
  "clubSettings.positions.language.es": "español",
  "clubSettings.positions.otherName": "En {language}: {name}",
  "clubSettings.positions.missingName":
    "Todavía sin nombre en {language}: se muestra este.",
  "clubSettings.positions.move.up": "Subir",
  "clubSettings.positions.move.up.label": "Subir {name}",
  "clubSettings.positions.move.down": "Bajar",
  "clubSettings.positions.move.down.label": "Bajar {name}",
  "clubSettings.positions.rename": "Renombrar",
  "clubSettings.positions.archive": "Archivar",
  "clubSettings.positions.archive.label": "Archivar {name}",
  "clubSettings.positions.reactivate": "Reactivar",
  "clubSettings.positions.reactivate.label": "Reactivar {name}",
  "clubSettings.positions.moved":
    "{name} queda en el puesto {rank} de {total}.",
  "clubSettings.positions.created": "{name} añadida.",
  "clubSettings.positions.renamed": "Nombre guardado.",
  "clubSettings.positions.archived":
    "{name} archivada: quien la tiene la conserva.",
  "clubSettings.positions.reactivated": "{name} se puede volver a elegir.",
  "clubSettings.positions.retry": "Volver a intentarlo",
  "clubSettings.positions.reloadLatest": "Cargar las últimas posiciones",
  "clubSettings.positions.issue.nameRequired":
    "Dale a la posición un nombre en al menos un idioma.",
  "clubSettings.positions.issue.nameTooLong": "Hasta {max} caracteres.",
  "clubSettings.positions.issue.nameTaken": "Otra posición ya se llama así.",
  "clubSettings.positions.error.changed":
    "Otro Admin cambió las posiciones mientras las editabas. Carga las últimas y vuelve a intentarlo.",
};
