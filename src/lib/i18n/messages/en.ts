import type { Message } from "../message";

/** Los textos en inglés, agrupados por pantalla. Las claves nacen aquí y el
 * resto de idiomas tiene que dar las mismas. `auth.emailRequest.retryAfter`
 * es la clave de ejemplo con la que se prueban los plurales del traductor. */
export const englishMessages = {
  "auth.passwordRecovery.checkEmailTitle": "Check your email",
  "auth.passwordRecovery.linkSent":
    "If {email} has a club account, we sent it a link to choose a new password.",
  "auth.emailRequest.retryAfter": {
    one: "{count} minute to go before you can ask for another link.",
    other: "{count} minutes to go before you can ask for another link.",
  },
  "auth.brand.eyebrow": "Underwater rugby · Melbourne",
  "auth.brand.headline": "Your club, beneath the surface.",
  "auth.brand.copy":
    "Training, teams, assessments and fees. Everything the Seadragons need in and out of the water.",

  "auth.field.fullName": "Full name",
  "auth.field.email": "Email",
  "auth.field.password": "Password",
  "auth.field.country": "Country",
  "auth.field.dateOfBirth": "Date of birth",
  "auth.field.membershipType": "Membership type",
  "auth.field.countryPlaceholder": "Select your country",
  "auth.field.membershipTypePlaceholder": "Select your membership",
  "auth.field.passwordHint": "At least {min} characters.",
  "auth.form.fieldIssues": "Check these fields before continuing:",
  "auth.error.network":
    "We couldn't reach the server. Check your connection and try again.",

  "auth.signIn.metaTitle": "Sign in · {club}",
  "auth.signIn.metaDescription":
    "Sign in to the {club} underwater rugby club platform.",
  "auth.signIn.title": "Welcome back",
  "auth.signIn.lead": "Sign in to your Seadragons account.",
  "auth.signIn.forgotPassword": "Forgot your password?",
  "auth.signIn.submit": "Sign in",
  "auth.signIn.firstTime": "New to the club?",
  "auth.signIn.createAccount": "Create an account",
  "auth.signIn.emptyCredentials": "Enter your email and password to sign in.",
  // El mismo texto para un correo sin cuenta y una contraseña equivocada, como
  // en español: dos frases distintas delatarían qué direcciones tienen cuenta.
  "auth.signIn.invalidCredentials": "The email or password is incorrect.",
  "auth.signIn.accountUnavailable":
    "Your account can't sign in right now. Contact the club so they can look into it.",
  "auth.signIn.unexpected": "We couldn't sign you in. Try again in a moment.",

  "auth.registration.metaTitle": "Create your account · {club}",
  "auth.registration.metaDescription":
    "Sign up to the {club} underwater rugby club platform.",
  "auth.registration.title": "Create your account",
  "auth.registration.lead":
    "The club signs you up with these details. We'll send you a link to confirm your email.",
  "auth.registration.submit": "Create account",
  "auth.registration.rejected":
    "We couldn't create your account with these details. Check them and try again.",
  "auth.registration.rateLimited": {
    one: "There were several sign-ups in a row. Wait {count} minute before trying again.",
    other:
      "There were several sign-ups in a row. Wait {count} minutes before trying again.",
  },
  "auth.registration.unexpected":
    "We couldn't create your account. Try again in a moment.",
  "auth.registration.confirmTitle": "Confirm your email",
  // Ninguno de estos textos puede dar por hecho que la dirección tiene cuenta
  // (#147): una condición ("if this address…") vale igual para cualquiera.
  "auth.registration.emailSent":
    "We sent a link to {email}. Open it to finish: until then your account stays incomplete and you can't sign in.",
  "auth.registration.emailSentNote":
    "If it doesn't arrive within a few minutes, resend it from here.",
  "auth.registration.emailPending":
    "To finish, you need to open the link we'll send to {email}. Until then your account stays incomplete and you can't sign in.",
  "auth.registration.emailUnavailable":
    "We can't send emails right now, so the link hasn't gone out yet. Try again later.",
  "auth.registration.previousRegistration":
    "If this address had already signed up before, the details from that sign-up still apply, password included: what you just entered doesn't change them.",
  "auth.registration.resend": "Resend the email",
  "auth.registration.retrySend": "Retry sending",
  "auth.registration.resendStillUnavailable":
    "We tried again and still can't send emails.",
  "auth.registration.resendRequested":
    "If that address has an unconfirmed account, the link is on its way.",
  "auth.registration.resendNetwork":
    "We couldn't ask for another email because we couldn't reach the server. Check your connection and try again.",
  "auth.registration.resendUnexpected":
    "We couldn't ask for another email. Try again in a moment.",

  "auth.confirmation.confirmedTitle": "Your email is confirmed",
  "auth.confirmation.activeBody":
    "Your account is now active. Sign in with this email and your password.",
  "auth.confirmation.activeNote": "You can now use the club platform.",
  "auth.confirmation.incompleteBody":
    "Your account still needs some details before it can be used, so it stays incomplete.",
  "auth.confirmation.incompleteNote":
    "Sign in with this email and your password, and we'll ask you for what's missing.",
  "auth.confirmation.invalidTitle": "This link no longer works",
  "auth.confirmation.invalidBody":
    "The confirmation link has expired or was already used. {anotherLinkSteps}",
  "auth.confirmation.errorTitle": "We couldn't confirm your email",
  "auth.confirmation.errorBody":
    "Something went wrong on our side, not with your link. That link was used up in the attempt. {anotherLinkSteps}",
  // Registrarse otra vez NO manda ningún enlace (#179): sólo devuelve a la
  // pantalla de confirmación, y ahí el enlace lo pide el botón.
  "auth.confirmation.anotherLinkSteps":
    "To get another one, start signing up again with the same email: you'll return to the confirmation screen, and there you can ask for a new one with the “{resendButton}” button.",
  "auth.confirmation.contactClub":
    "If the problem continues, contact the club.",
  "auth.confirmation.backToRegistration": "Back to sign-up",

  "auth.completion.metaTitle": "Finish signing up · {club}",
  "auth.completion.metaDescription":
    "Fill in the details your {club} club account is missing.",
  "auth.completion.title": "Finish signing up",
  "auth.completion.lead":
    "Your account needs this before you can get in. We won't ask for anything you've already given us.",
  "auth.completion.submit": "Save and continue",
  "auth.completion.nothingLeftTitle": "Nothing left to do",
  "auth.completion.nothingLeftLead":
    "Your account is complete. Go to the dashboard to get started.",
  "auth.completion.goToDashboard": "Go to the dashboard",
  "auth.completion.confirmEmailBody":
    "We sent a link to {email}. Open it to finish: until then your account stays incomplete.",
  "auth.completion.resendSent":
    "The link is on its way. Check your junk folder too.",
  "auth.completion.signInRequired":
    "You need to sign in to view or complete your account.",
  "auth.completion.notAMember":
    "Your session doesn't match any club member. Contact the club so they can look into it.",
  "auth.completion.noLongerNeeded":
    "Your account no longer needs this. Reload the page to see what's still missing.",
  "auth.completion.rejected": "Some details can't be saved.",
  "auth.completion.unexpected":
    "We couldn't save your details. Try again in a moment.",

  "auth.guardian.title": "Your guardian's consent is missing",
  "auth.guardian.body":
    "You were under 18 on the day you signed up. Your account won't be activated until your parent or guardian gives their consent. Fill this in together.",
  "auth.guardian.detailIssues": "Check these details before continuing:",
  "auth.guardian.name": "Guardian's name",
  "auth.guardian.email": "Guardian's email",
  "auth.guardian.consent":
    "I am their parent or legal guardian and I consent to the {club} club processing the data in this account.",
  "auth.guardian.submit": "Record consent",

  "auth.passwordRecovery.metaTitle": "Reset your password · {club}",
  "auth.passwordRecovery.metaDescription":
    "Ask for a link to choose a new password on the {club} club platform.",
  "auth.passwordRecovery.title": "Reset your password",
  "auth.passwordRecovery.lead":
    "Enter your account email and we'll send you a link to choose a new password.",
  "auth.passwordRecovery.submit": "Send link",
  "auth.passwordRecovery.linkNote":
    "The link expires after {minutes} minutes and works only once. If it doesn't arrive, check your spam folder or ask for it again.",
  "auth.passwordRecovery.backToSignIn": "Back to sign in",
  "auth.passwordRecovery.emptyEmail":
    "Enter your account email to ask for the link.",
  "auth.passwordRecovery.rateLimited": {
    one: "You asked for several links in a row. Wait {count} minute before asking for another.",
    other:
      "You asked for several links in a row. Wait {count} minutes before asking for another.",
  },
  "auth.passwordRecovery.emailUnavailable":
    "Email sending isn't available right now, so we can't send you the link. If you need to sign in now, contact the club.",
  "auth.passwordRecovery.unexpected":
    "We couldn't request the link. Try again in a moment.",

  "auth.newPassword.metaTitle": "Choose your new password · {club}",
  "auth.newPassword.metaDescription":
    "Choose a new password for your {club} club account.",
  "auth.newPassword.title": "Choose your new password",
  "auth.newPassword.lead":
    "It's the one you'll use from now on to sign in to the club.",
  "auth.newPassword.label": "New password",
  "auth.newPassword.submit": "Save password",
  "auth.newPassword.unexpected":
    "We couldn't change your password. Try again in a moment.",
  "auth.newPassword.linkUnusableTitle": "This link no longer works",
  "auth.newPassword.linkUnusableBody":
    "The link to change your password has expired or was already used. Each link lasts {minutes} minutes and works only once.",
  "auth.newPassword.passwordRejected":
    "We couldn't use that password: it's the same as the previous one or too weak. The link was used up in the attempt, so ask for another link and choose a different one.",
  "auth.newPassword.requestAnotherLink": "Ask for another link",
  "auth.newPassword.changedTitle": "Your password has been changed",
  "auth.newPassword.changedLead": "You can now sign in with your new password.",

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
  "nav.sidebarLabel": "Main",
  "nav.tabBarLabel": "Sections",
  "nav.more": "More",
  // Los nombres de escritorio son los de docs/mockups/dashboard-light.png.
  "nav.label.dashboard": "Dashboard",
  "nav.label.directory": "Directory",
  "nav.label.calendar": "Calendar",
  "nav.label.teams": "Teams",
  "nav.label.evaluations": "Evaluations",
  "nav.label.news": "News",
  "nav.label.payments": "Payments",
  "nav.label.groups": "Groups",
  // Las etiquetas cortas de la barra móvil. "Home" es la del mockup
  // (docs/mockups/mobile-home-light.png); "Calendar", la otra, no se parte a
  // 360px pero con DejaVu Sans, la fuente que resuelve Linux, ocupa el 84% de
  // su pestaña y roza el margen que exige la suite. "Events" ocupa el 64%.
  "nav.label.dashboardShort": "Home",
  "nav.label.calendarShort": "Events",
  // Directory only becomes a fixed tab for the roles that don't see Teams
  // (#213). Measured against "Calendar", "Directory" would take about 89% of
  // its tab with DejaVu Sans, over the suite's margin; "Members" is as wide.
  "nav.label.directoryShort": "People",
  "app.metaDescription":
    "The platform of the {club} underwater rugby club (Melbourne).",
  "section.underConstruction": "This section is under construction.",
  "home.lead":
    "The underwater rugby club platform. This is the initial shell: the rest of the features arrive epic by epic, each with its own tickets and review.",
  "home.status.title": "Service status",
  "home.status.body":
    "The versioned API answers on the health endpoint, which queries the database.",
  "signOut.label": "Sign out",
  // Mi cuenta (#209). Los roles se escriben como en el SRD en inglés.
  "account.link": "My account",
  // El menú de la cuenta (#287), que abre el botón de la cuenta.
  "accountMenu.profile": "My profile",
  "accountMenu.appearance": "Appearance",
  "accountMenu.language": "Language",
  "accountMenu.back": "Back",
  "accountMenu.clubSettings": "Club settings",
  "account.metaTitle": "Profile · {club}",
  "account.metaDescription":
    "Your details, your role in the club and your groups, plus a request to become a Coach or join the Committee.",
  "account.roleLine": "Role: {role}",
  "role.Admin": "Admin",
  "role.Coach": "Coach",
  "role.Committee": "Committee",
  "role.Player": "Player",
  "account.request.title": "Request a role",
  "account.request.body":
    "An Admin reviews every request. You'll keep your current role until they approve it.",
  "account.request.roleLegend": "Role to request",
  "account.request.justification": "Why do you want this role? (optional)",
  "account.request.characterCount": "{used}/{max}",
  "account.request.justificationTooLong":
    "The note can be at most {max} characters. Shorten it to send the request.",
  "account.request.roleMissing": "Choose the role you want to request.",
  "account.request.submit": "Send request",
  "account.request.sending": "Sending…",
  "account.pending.title": "Request pending",
  "account.pending.body":
    "You asked to be {role} on {date}. An Admin hasn't answered yet.",
  "account.adminNote":
    "As an Admin you already have every capability, so there is no role to request.",
  // Mis grupos (#229). Sólo los grupos propios, sin sus demás miembros.
  "account.groups.title": "My groups",
  "account.groups.empty": "You don't belong to any group yet.",
  "account.error.pending":
    "You already have a request waiting for an answer. Reload the page to see it.",
  "account.error.roleAlreadyHeld": "You already have that role.",
  "account.error.signInRequired":
    "Your session has ended. Sign in again to send the request.",
  "account.error.forbidden": "Your account can't request a role right now.",
  "account.error.unexpected":
    "We couldn't send the request. Try again in a moment.",
  // El perfil propio (#241). Posición y nivel se guardan con la grafía del
  // SRD; género, como código.
  "account.profile.title": "Your details",
  "account.profile.fullName": "Full name",
  "account.profile.country": "Country",
  "account.profile.position": "Position",
  "account.profile.positionRetired": "{name} (retired)",
  "account.profile.experienceLevel": "Experience level",
  "account.profile.gender": "Gender",
  "account.profile.notSet": "Not set",
  "account.profile.save": "Save changes",
  "account.profile.saving": "Saving…",
  "account.profile.saved": "Changes saved.",
  "account.profile.issue.fullNameMissing": "Write your name.",
  "account.profile.issue.fullNameTooLong":
    "Your name can be at most {max} characters.",
  "account.profile.issue.countryUnknown": "Choose your country from the list.",
  "account.profile.issue.positionUnknown": "Choose a position from the list.",
  "account.profile.issue.experienceLevelUnknown":
    "Choose an experience level from the list.",
  "account.profile.issue.genderUnknown": "Choose a gender from the list.",
  "account.profile.error.network":
    "We couldn't save your changes. Check your connection and try again.",
  "account.profile.error.signInRequired":
    "Your session has ended. Sign in again to save your changes.",
  "account.profile.error.forbidden":
    "Your account can't change these details right now.",
  "account.profile.error.unexpected":
    "We couldn't save your changes. Try again in a moment.",
  // El AUF del perfil propio (#274): lo escribe el miembro y queda pendiente
  // hasta que un Admin lo verifica.
  "account.profile.auf.title": "AUF registration",
  "account.profile.auf.number": "AUF number",
  "account.profile.auf.expiry": "AUF expiry",
  "account.profile.auf.hint":
    "An Admin checks it before it counts as verified.",
  "account.profile.auf.pending": "Pending verification by an Admin.",
  "account.profile.auf.verified":
    "Verified by an Admin. Only an Admin can change it.",
  "account.profile.auf.summary": "AUF {number} · expires {date}",
  "account.profile.auf.withoutExpiry": "AUF {number} · no expiry",
  "account.profile.issue.aufNumberMissing": "Write your AUF number.",
  "account.profile.issue.aufNumberTooLong":
    "Your AUF number can be at most {max} characters.",
  "account.profile.issue.aufExpiryNotADate": "Write a valid expiry date.",
  "account.profile.issue.aufExpiryBeforeJoined":
    "The expiry can't be before the day you joined the club.",
  "account.profile.error.aufVerified":
    "Your AUF is already verified. Only an Admin can change it.",
  // La foto de perfil (#245): el círculo de la cabecera y sus controles.
  "account.photo.alt": "Your profile photo",
  "account.photo.add": "Add photo",
  "account.photo.change": "Change photo",
  "account.photo.remove": "Remove photo",
  "account.photo.choose": "Choose a photo",
  "account.photo.hint": "JPEG, PNG or WebP, up to {max} MB.",
  "account.photo.uploading": "Uploading…",
  "account.photo.removing": "Removing…",
  "account.photo.saved": "Photo updated.",
  "account.photo.removed": "Photo removed.",
  "account.photo.retry": "Try again",
  "account.photo.issue.photoTooLarge":
    "This photo is larger than {max} MB. Choose a smaller one.",
  "account.photo.issue.photoTypeUnsupported":
    "Only JPEG, PNG or WebP photos are accepted.",
  "account.photo.issue.photoEmpty": "This file is empty. Choose another photo.",
  "account.photo.error.network":
    "We couldn't reach the server. Your photo hasn't changed. Check your connection and try again.",
  "account.photo.error.signInRequired":
    "Your session has ended. Sign in again to change your photo.",
  "account.photo.error.forbidden":
    "Your account can't change its photo right now.",
  "account.photo.error.unexpected":
    "Something went wrong and your photo hasn't changed. Try again in a moment.",
  "level.Beginner": "Beginner",
  "level.Intermediate": "Intermediate",
  "level.Advanced": "Advanced",
  "gender.female": "Female",
  "gender.male": "Male",
  "gender.non_binary": "Non-binary",
  "gender.undisclosed": "Prefer not to say",

  // La bandeja de solicitudes y el cambio de rol (#212), que viven en el
  // directorio desde #240. Los nombres de rol salen de las
  // claves `role.*` de arriba, que ya las usa Mi cuenta.
  "admin.loading": "Loading the pending requests…",
  "admin.loadFailed": "We couldn't load the pending requests.",
  "admin.retry": "Try again",
  "admin.requests.title": "Pending requests",
  "admin.requests.empty": "No requests are waiting for an answer.",
  "admin.requests.asked": "{name} asked to be {role}",
  "admin.requests.askedOn": "Asked on {date}",
  "admin.requests.noJustification": "They didn't write a note.",
  "admin.requests.approve": "Approve",
  "admin.requests.reject": "Reject",
  "admin.requests.approveLabel": "Approve the request from {name}",
  "admin.requests.rejectLabel": "Reject the request from {name}",
  "admin.requests.approved": "{name} is now {role}.",
  "admin.requests.rejected": "The request from {name} was rejected.",
  "admin.members.roleLabel": "Role for {name}",
  "admin.members.save": "Save",
  "admin.members.saveLabel": "Save the role for {name}",
  "admin.members.saving": "Saving…",
  "admin.members.saved": "{name} is now {role}.",
  "admin.error.alreadyDecided": "Another Admin already answered this request.",
  "admin.error.lastAdmin":
    "This is the club's last Admin. Name another Admin before changing this role.",
  "admin.error.roleAlreadyGranted":
    "That member already has that role or a higher one. Reject the request instead.",
  "admin.error.gone": "That request is no longer in the club.",
  "admin.error.memberGone": "That member is no longer in the club.",
  "admin.error.signInRequired":
    "Your session has ended. Sign in again to keep going.",
  "admin.error.forbidden": "Your role can't manage members and roles.",
  "admin.error.unexpected": "We couldn't finish that. Try again in a moment.",
  // La sección Grupos (#228, RF-2 a RF-7 del PRD de E4). Los errores se
  // traducen por su código, no por la frase que manda el servidor.
  "groups.metaTitle": "Groups · {club}",
  "groups.metaDescription":
    "Create the club's groups and choose which members belong to each one.",
  "groups.title": "Groups",
  "groups.lead":
    "Groups gather members so a session, an event or a post can be aimed at them.",
  "groups.loading": "Loading the club's groups…",
  "groups.loadFailed": "We couldn't load the club's groups.",
  "groups.retry": "Try again",
  "groups.list.title": "Club groups",
  "groups.list.empty":
    "This club has no groups yet. Create the first one to start gathering members.",
  "groups.memberCount": {
    one: "{count} member",
    other: "{count} members",
  },
  "groups.create.label": "Name of the new group",
  "groups.create.submit": "Create group",
  "groups.create.saving": "Creating…",
  "groups.rename": "Rename",
  "groups.renameLabel": "Rename {name}",
  "groups.renameField": "New name for {name}",
  "groups.renameSubmit": "Save the new name",
  "groups.renameSaving": "Saving…",
  "groups.cancel": "Cancel",
  "groups.delete": "Delete",
  "groups.deleteLabel": "Delete {name}",
  "groups.deleteQuestion": {
    one: "Delete “{name}”? It has {count} member. They stay in the club.",
    other: "Delete “{name}”? It has {count} members. They stay in the club.",
  },
  "groups.deleteSubmit": "Delete group",
  "groups.deleting": "Deleting…",
  "groups.members.title": "Members of {name}",
  "groups.members.loading": "Loading this group's members…",
  "groups.members.loadFailed": "We couldn't load this group's members.",
  "groups.members.empty":
    "This group has no members yet. Add the first one from the list.",
  "groups.members.close": "Close the group",
  "groups.members.remove": "Remove",
  "groups.members.pendingActivation": "Pending activation",
  "groups.members.removeLabel": "Remove {name} from the group",
  "groups.members.removing": "Removing…",
  "groups.members.addLabel": "Member to add",
  "groups.members.add": "Add to the group",
  "groups.members.adding": "Adding…",
  "groups.members.noCandidates":
    "Every member of the club is already in this group.",
  "groups.error.nameTaken": "The club already has a group with that name.",
  "groups.error.invalidName":
    "The name must have between 1 and {max} characters.",
  "groups.error.groupGone": "That group is no longer in the club.",
  "groups.error.memberInactive":
    "That member's account is deactivated, so they can't be added.",
  "groups.error.signInRequired":
    "Your session has ended. Sign in again to keep going.",
  "groups.error.forbidden": "Your role can't manage the club's groups.",
  "groups.error.unexpected": "We couldn't finish that. Try again in a moment.",

  // El directorio del club (#239, RF-2 del PRD de E5). Los catálogos que la
  // base guarda en inglés (el rol, la posición y el nivel) se traducen por
  // clave: `role.*` ya existía para Mi cuenta.
  "directory.metaTitle": "Directory · {club}",
  "directory.metaDescription":
    "Everyone in the club, with their country, level, role and position.",
  "directory.title": "Directory",
  "directory.lead":
    "Everyone in the club. Search by name, filter by role and sort the list.",
  "directory.loading": "Loading the club's directory…",
  "directory.retry": "Try again",
  "directory.list.title": "Club members",
  "directory.memberCount": {
    one: "{count} member",
    other: "{count} members",
  },
  "directory.search.label": "Search by name",
  "directory.search.placeholder": "Search members…",
  "directory.role.legend": "Filter by role",
  "directory.role.all": "All",
  "directory.includeInactive": "Include deactivated accounts",
  "directory.empty": "No member matches what you're looking for.",
  "directory.clearFilters": "Clear the filters",
  "directory.column.member": "Member",
  "directory.column.role": "Role",
  "directory.column.position": "Position",
  // #283: por debajo de 768px la tabla es una lista de tarjetas, sin
  // cabeceras. Cada dato lleva su etiqueta y el orden tiene su propio control.
  "directory.field.country": "Country",
  "directory.field.level": "Level",
  "directory.sort.label": "Sort by",
  "directory.sort.directionLabel": "Order",
  "directory.sort.direction.asc": "Ascending",
  "directory.sort.direction.desc": "Descending",
  "directory.mark.inactive": "Deactivated",
  "directory.mark.aufExpired": "AUF expired",
  // #274: el AUF que escribió el miembro, hasta que un Admin lo verifica.
  "directory.mark.aufNotVerified": "AUF not verified",
  "directory.mark.aufVerified": "AUF verified",
  "directory.mark.pendingActivation": "Pending activation",
  "directory.error.signInRequired":
    "Your session ended. Sign in again to see the directory.",
  "directory.error.forbidden": "Your account can't see the club's directory.",
  "directory.error.unexpected":
    "We couldn't load the club's directory. Try again.",

  // La ficha reservada al Admin (#242, RF-4 del PRD de E5): el AUF y los
  // grupos de un miembro, abierta desde su fila del directorio.
  "memberRecord.metaTitle": "Member record · {club}",
  "memberRecord.metaDescription":
    "A member's AUF registration and groups, which only an Admin edits.",
  "memberRecord.back": "← Back to the directory",
  "memberRecord.openLabel": "Open {name}'s record",
  "memberRecord.loading": "Loading the member's record…",
  "memberRecord.lead":
    "What only an Admin edits: the AUF registration, the date of birth and the groups.",
  "memberRecord.joinedOn": "Member since {date}",
  "memberRecord.auf.title": "AUF registration",
  "memberRecord.auf.number": "AUF number",
  "memberRecord.auf.expiry": "Expiry date",
  "memberRecord.auf.hint": "Clearing the number also clears its expiry date.",
  "memberRecord.auf.pending":
    "The member wrote this AUF. Check it and verify it, or correct it and save: what you write is verified.",
  "memberRecord.auf.verify": "Verify AUF",
  "memberRecord.auf.verifying": "Verifying…",
  "memberRecord.auf.verified": "AUF verified.",
  "memberRecord.birth.title": "Personal details",
  "memberRecord.birth.label": "Date of birth",
  "memberRecord.birth.hint":
    "The member can't change it: it decides whether they need a guardian's consent.",
  "memberRecord.birth.guardianNotice":
    "When you save, {name} will have to give a guardian's details and consent the next time they sign in.",
  "memberRecord.groups.legend": "Groups",
  "memberRecord.groups.empty": "The club has no groups yet.",
  "memberRecord.save": "Save the record",
  "memberRecord.saving": "Saving…",
  "memberRecord.saved": "Record saved.",
  "memberRecord.issue.aufNumberTooLong":
    "The AUF number can have at most {max} characters.",
  "memberRecord.issue.aufExpiryNotADate": "That expiry isn't a valid date.",
  "memberRecord.issue.aufExpiryBeforeJoined":
    "The expiry can't be before the date they joined ({date}).",
  "memberRecord.issue.dateOfBirthRequired":
    "A date of birth that's already recorded can't be cleared.",
  "memberRecord.error.memberNotFound": "That member isn't in the club.",
  "memberRecord.error.groupNotFound":
    "One of those groups is no longer in the club. Reload the record.",
  "memberRecord.error.memberInactive":
    "A member with a deactivated account can't be added to groups.",
  "memberRecord.error.memberStatusChanged":
    "The member's account changed while saving. Reload the record and try again.",
  "memberRecord.error.aufChanged":
    "The member changed the AUF after you opened the record. Reload it before verifying.",
  "memberRecord.error.signInRequired":
    "Your session ended. Sign in again to keep going.",
  "memberRecord.error.forbidden": "Only an Admin can see and edit this record.",
  "memberRecord.error.unexpected": "We couldn't save the record. Try again.",
  "directory.aufSummary": "AUF {number} · expires {date}",
  "directory.aufWithoutExpiry": "AUF {number} · no expiry date",
  "directory.aufMissing": "No AUF",
  // La invitación de un miembro por un Admin (#243, RF-5 del PRD de E5), abierta
  // desde la cabecera del directorio.
  "directory.addMember": "Invite member",
  "newMember.metaTitle": "Invite member · {club}",
  "newMember.metaDescription":
    "Invite a member to the club and send them an email to activate their account.",
  "newMember.title": "Invite member",
  "newMember.lead":
    "They join as a Player and get an email to activate their account. Their role can be changed from the directory.",
  "newMember.loading": "Loading the club's groups…",
  "newMember.loadFailed": "We couldn't load the club's groups. Try again.",
  "newMember.details.title": "Member details",
  "newMember.fullName": "Full name",
  "newMember.email": "Email",
  "newMember.country": "Country",
  "newMember.position": "Position",
  "newMember.experienceLevel": "Experience level",
  "newMember.gender": "Gender",
  "newMember.choose": "Choose one",
  "newMember.auf.title": "AUF registration",
  "newMember.auf.number": "AUF number",
  "newMember.auf.expiry": "AUF expiry date",
  "newMember.submit": "Invite member",
  "newMember.sending": "Inviting…",
  "newMember.created.sent":
    "{name} was invited. We sent the invitation to {email}.",
  "newMember.created.notSent":
    "We created {name}'s account, but the invitation could not be sent.",
  "newMember.resend": "Resend invitation",
  "newMember.resending": "Resending…",
  "newMember.resent": "We sent a new invitation to {email}.",
  "newMember.addAnother": "Invite another member",
  "newMember.issue.fullNameMissing": "Write the member's name.",
  "newMember.issue.emailMalformed": "Write a valid email address.",
  "newMember.issue.countryUnknown": "Choose a country.",
  "newMember.issue.positionUnknown": "Choose a position.",
  "newMember.issue.experienceLevelUnknown": "Choose an experience level.",
  "newMember.issue.genderUnknown": "Choose an option.",
  "newMember.issue.aufNumberMissing": "Write the AUF number.",
  "newMember.issue.aufNumberTooLong":
    "The AUF number can have at most {max} characters.",
  "newMember.issue.aufExpiryNotADate": "Write the AUF expiry date.",
  "newMember.issue.aufExpiryInThePast":
    "The AUF has already expired. Check the date.",
  "newMember.error.emailTaken":
    "That email already has an account in the club.",
  "newMember.error.groupNotFound":
    "One of those groups is no longer in the club. Reload the page.",
  "newMember.error.invitationNotSent":
    "The invitation could not be sent. Try again later.",
  "newMember.error.rateLimited":
    "Several invitations were sent in a row. Wait a few minutes before asking for another.",
  "newMember.error.forbidden": "Only an Admin can invite members.",
  "newMember.error.unexpected": "We couldn't invite the member. Try again.",
  "newMember.error.invitationNotPending":
    "This member has already activated their account.",
  "memberRecord.invitation.title": "Invitation",
  "memberRecord.invitation.lead":
    "{name} hasn't activated their account yet. The invitation link expires after an hour, so you can send a new one.",
  "memberRecord.invitation.resent": "We sent {name} a new invitation.",
  // Desactivar y reactivar la cuenta desde la ficha (#244, RF-6 del PRD de E5).
  "memberStatus.title": "Membership",
  "memberStatus.lead.active":
    "{name} is a member of the club. Deactivating their account keeps their history, but they can no longer sign in or appear in the directory.",
  "memberStatus.lead.inactive":
    "{name}'s account is deactivated. Their history is kept, and reactivating it lets them sign in and appear in the directory again.",
  "memberStatus.deactivate": "Deactivate account",
  "memberStatus.reactivate": "Reactivate account",
  "memberStatus.saving": "Saving…",
  "memberStatus.deactivated": "{name}'s account was deactivated.",
  "memberStatus.reactivated": "{name}'s account was reactivated.",
  "memberStatus.error.lastAdmin":
    "This is the club's last Admin, so their account can't be deactivated. Name another Admin first.",
  "memberStatus.error.selfDeactivation":
    "You can't deactivate your own account. Another Admin has to do it.",
  "memberStatus.error.notAudited":
    "The membership changed, but it couldn't be logged. Reload the record and tell whoever maintains the platform.",
  "memberStatus.error.unexpected":
    "We couldn't change their membership. Try again.",
  // La campana y su lista (#266). Cada tipo de aviso tiene su título y su
  // cuerpo; los datos del aviso entran como parámetros.
  "notifications.bell.label": {
    one: "Notifications, {count} unread",
    other: "Notifications, {count} unread",
  },
  "notifications.bell.labelNoneUnread": "Notifications, none unread",
  "notifications.panel.title": "Notifications",
  "notifications.panel.markAllRead": "Mark all read",
  "notifications.panel.back": "Back",
  "notifications.panel.loading": "Loading your notifications…",
  "notifications.panel.empty": "You don't have any notifications yet.",
  "notifications.panel.unread": "New",
  "notifications.panel.error.load": "We couldn't load your notifications.",
  "notifications.panel.error.markRead":
    "We couldn't mark your notifications as read.",
  "notifications.panel.retry": "Try again",
  "notifications.role_changed.title": "Your role changed",
  "notifications.role_changed.body": "You are now {role}.",
  "notifications.role_request_rejected.title": "Role request declined",
  "notifications.role_request_rejected.body":
    "An Admin declined your request to be {role}.",
  "notifications.role_request_received.title": "New role request",
  "notifications.role_request_received.body": "{name} asked to be {role}.",
  "notifications.generic.title": "New notification",
  "notifications.generic.body": "Something changed in your account.",
  "themeToggle.switchToLight": "Switch to light theme",
  "themeToggle.switchToDark": "Switch to dark theme",
  // El destino va con su propio nombre ("Español", no "Spanish"): quien no
  // entiende el idioma de la pantalla tiene que reconocer el suyo. Y el
  // nombre repite el código que se ve en el botón, para que quien lo maneja
  // con la voz pueda decir "ES" (WCAG 2.5.3).
  "languageToggle.label": "Language: English. Switch to Español (ES)",
  "languageToggle.target": "ES",

  // Los dos correos del club (RF-6). Salen en el idioma guardado en la fila
  // del socio, no en el de la visita: se mandan después de responder.
  "email.signature": "{clubName}, underwater rugby club in Melbourne.",
  "email.recovery.subject": "Reset your {clubName} password",
  "email.recovery.requested":
    "Someone asked to change the password for your {clubName} account.",
  "email.recovery.linkLifetime": {
    one: "The link works only once and expires in {count} minute.",
    other: "The link works only once and expires in {count} minutes.",
  },
  "email.recovery.button": "Choose a new password",
  "email.recovery.linkLabel": "To choose a new password, open this link",
  "email.recovery.notYou":
    "If you didn't ask for this, ignore this email: your password stays the same.",
  "email.confirmation.subject": "Confirm your email for {clubName}",
  "email.confirmation.registered":
    "You signed up to {clubName} with this address.",
  "email.confirmation.linkLifetime": {
    one: "The link expires in {count} minute.",
    other: "The link expires in {count} minutes.",
  },
  "email.confirmation.ifExpired":
    "If it expires, ask for another one with the “{resendButton}” button on the confirmation screen. If you already closed it, start signing up again with this address and you'll return to that screen.",
  "email.confirmation.button": "Confirm my email",
  "email.confirmation.linkLabel": "To confirm your email, open this link",
  "email.confirmation.notYou":
    "If you didn't sign up, ignore this email: the account won't activate until it's confirmed.",
  "email.invitation.subject": "You're invited to {clubName}",
  "email.invitation.invited":
    "The club has invited you to {clubName} with this address.",
  "email.invitation.nextSteps":
    "To activate your account, open the link, choose a password and sign in with it. Then complete your registration with any missing details.",
  "email.invitation.linkLifetime": {
    one: "The link works once and expires in {count} minute.",
    other: "The link works once and expires in {count} minutes.",
  },
  "email.invitation.button": "Activate my account",
  "email.invitation.linkLabel": "To activate your account, open this link",
  "email.invitation.ifExpired":
    "If it expires, ask the club to resend your invitation.",
  "email.invitation.notYou":
    "If you weren't expecting this invitation, ignore this email: the account stays unused until it is activated.",
  // La configuración del club (#296, RF-6 del PRD de E18a), sólo del Admin.
  "clubSettings.metaTitle": "Club settings · {club}",
  "clubSettings.metaDescription":
    "The club's name, initials, accent colour and logo, as members see them on every screen.",
  "clubSettings.title": "Club settings",
  "clubSettings.lead":
    "How the club appears to its members: in the header, on the sign-in screen and in every email.",
  "clubSettings.loading": "Loading the club settings…",
  "clubSettings.identity.title": "Name and initials",
  "clubSettings.name.label": "Club name",
  "clubSettings.name.hint": "Up to {max} characters.",
  "clubSettings.initials.label": "Initials",
  "clubSettings.initials.hint":
    "Up to {max} characters. Leave it empty to use the first letters of the name.",
  "clubSettings.brand.title": "Colour and logo",
  "clubSettings.accent.label": "Accent colour",
  "clubSettings.logo.label": "Logo",
  "clubSettings.logo.none": "No logo yet: the initials are shown instead.",
  "clubSettings.logo.present": "The club has a logo.",
  "clubSettings.logo.add": "Upload logo",
  "clubSettings.logo.change": "Change logo",
  "clubSettings.logo.remove": "Remove logo",
  "clubSettings.logo.choose": "Choose a logo",
  "clubSettings.logo.hint": "PNG or WebP, up to {max} KB.",
  "clubSettings.logo.uploading": "Uploading…",
  "clubSettings.logo.removing": "Removing…",
  "clubSettings.logo.saved": "Logo updated.",
  "clubSettings.logo.removed": "Logo removed: the initials are back.",
  "clubSettings.logo.issue.logoEmpty":
    "This file is empty. Choose another logo.",
  "clubSettings.logo.issue.logoTooLarge":
    "This logo is larger than {max} KB. Choose a smaller one.",
  "clubSettings.logo.issue.logoTypeUnsupported":
    "Only PNG or WebP logos can be used.",
  "clubSettings.logo.issue.logoUndecodable":
    "This file cannot be read as an image. Choose another logo.",
  "club.logoAlt": "{club} logo",
  "clubSettings.save": "Save settings",
  "clubSettings.saving": "Saving…",
  "clubSettings.saved": "Settings saved.",
  "clubSettings.reloadLatest": "Load the latest settings",
  "clubSettings.issue.nameRequired": "The club needs a name.",
  "clubSettings.issue.nameTooLong":
    "The name can have at most {max} characters.",
  "clubSettings.issue.initialsTooLong":
    "Initials can have at most {max} characters.",
  "clubSettings.issue.accentInvalid":
    "The accent colour must be a hex code such as #1C6EA4.",
  "clubSettings.issue.accentNoReadableText":
    "No text colour reaches the minimum contrast (4.5:1) on this accent. Pick a lighter or darker one.",
  "clubSettings.error.changed":
    "Another Admin changed the settings while you were editing. Load the latest settings and make your change again.",
  "clubSettings.error.signInRequired":
    "Your session ended. Sign in again to keep going.",
  "clubSettings.error.forbidden": "Only an Admin can change the club settings.",
  "clubSettings.error.unexpected":
    "Something went wrong with the club settings. Try again.",
} as const satisfies Readonly<Record<string, Message>>;
