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
  "auth.brand.signInLink": "{club}: sign in",
  "auth.brand.eyebrow": "Underwater rugby · Melbourne",
  "auth.brand.headline": "Your club, beneath the surface.",
  "auth.brand.copy":
    "Training, teams, assessments and fees. Everything the Seadragons need in and out of the water.",

  "auth.field.fullName": "Full name",
  "auth.field.email": "Email",
  "auth.field.password": "Password",
  "auth.field.country": "Country",
  "auth.field.dateOfBirth": "Date of birth",
  "auth.field.countryPlaceholder": "Select your country",
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
  "auth.registration.haveAccount": "Already have an account?",
  "auth.registration.signIn": "Sign in",
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

  "auth.confirmEmail.metaTitle": "Confirm your email · {club}",
  "auth.confirmEmail.metaDescription":
    "Confirm the email address of your {club} club account.",
  "auth.confirmEmail.title": "Confirm your email",
  "auth.confirmEmail.lead":
    "Press the button to finish confirming your email address.",
  "auth.confirmEmail.submit": "Confirm my email",

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
  "nav.label.attendance": "Attendance",
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
  "section.loading": "Loading",
  "dashboard.eyebrow": "Dashboard",
  "dashboard.greeting.morning": "Good morning, {name}",
  "dashboard.greeting.afternoon": "Good afternoon, {name}",
  "dashboard.greeting.evening": "Good evening, {name}",
  "dashboard.newTraining": "New training",
  "dashboard.loading": "Loading…",
  "dashboard.retry": "Try again",
  "dashboard.error.unexpected": "We couldn't load the dashboard. Try again.",
  "dashboard.error.signInRequired":
    "Your session ended. Sign in again to see the dashboard.",
  "dashboard.unavailable": "Unavailable",
  "dashboard.tiles.label": "Club at a glance",
  "dashboard.tile.accessibleName": "{label}: {value}",
  "dashboard.tile.noData": "No data",
  "dashboard.tile.attendance": "Attendance",
  "dashboard.tile.clubRate": "Attendance rate",
  "dashboard.tile.clubRate.caption": "last 30 days",
  "dashboard.tile.ownAttendance": "Your attendance",
  "dashboard.tile.ownAttendance.caption": {
    one: "{count} session",
    other: "{count} sessions",
  },
  "dashboard.tile.members": "Active members",
  "dashboard.tile.members.caption": "+{count} this month",
  "dashboard.tile.nextTraining": "Next training",
  "dashboard.tile.nextTraining.today": "today {time}",
  "dashboard.tile.nextTraining.hours": "{count} h",
  "dashboard.tile.nextTraining.days": "{count} d",
  "dashboard.tile.nextTraining.caption": "{day} · {location}",
  "dashboard.tile.nextTraining.none": "No training scheduled",
  "dashboard.tile.unreadNews": "Unread news",
  "dashboard.tile.unreadNews.caption": {
    one: "{count} announcement",
    other: "{count} announcements",
  },
  "dashboard.tile.unreadNews.none": "All caught up",
  "dashboard.upcoming.title": "Upcoming",
  "dashboard.upcoming.all": "Calendar",
  "dashboard.upcoming.empty": "No upcoming events.",
  "dashboard.news.title": "Latest news",
  "dashboard.news.all": "All",
  "dashboard.news.empty": "No news yet.",
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
  "account.evaluation.title": "Evaluation",
  "account.evaluation.staffOnly":
    "Evaluation ratings are only visible to the coaching staff.",
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
  // El aviso de los datos de contacto que faltan (#498).
  "contactReminder.emergencyContact.title": "Add your emergency contact",
  "contactReminder.phone.title": "Add your phone number",
  "contactReminder.both.title": "Add your phone number and emergency contact",
  "contactReminder.emergencyContact.why":
    "So the club knows who to call if something happens to you at the pool.",
  "contactReminder.phone.why": "So the club can reach you if it needs to.",
  "contactReminder.link": "Complete it in Contact, on your profile",
  "contactReminder.dismissPhone": "Dismiss phone reminder",
  // El teléfono y el contacto de emergencia del perfil propio (#496).
  "account.profile.contact.title": "Contact",
  "account.profile.contact.phone": "Your phone (optional)",
  "account.profile.contact.emergencyLegend": "Emergency contact",
  "account.profile.contact.emergencyHint":
    "Who we call if something happens in the water. Fill in all three, or leave them empty.",
  "account.profile.contact.emergencyName": "Contact name",
  "account.profile.contact.emergencyPhone": "Contact phone",
  "account.profile.contact.emergencyRelationship": "Relationship",
  "account.profile.contact.samePhone":
    "This is your own phone. Your emergency contact should be someone else.",
  "account.profile.contact.guardianRelationship": "Guardian",
  "account.profile.contact.guardianProposed":
    "We've suggested your guardian. Add their phone number to save it.",
  "account.profile.issue.phoneInvalidCharacters":
    "Use only digits, spaces, hyphens, brackets and a + at the start.",
  "account.profile.issue.phoneTooShort":
    "A phone number needs at least {min} digits.",
  "account.profile.issue.phoneTooLong":
    "A phone number can have at most {max} digits.",
  "account.profile.issue.emergencyNameMissing":
    "Add the contact's name, or leave all three empty.",
  "account.profile.issue.emergencyPhoneMissing":
    "Add the contact's phone, or leave all three empty.",
  "account.profile.issue.emergencyRelationshipMissing":
    "Add how you're related, or leave all three empty.",
  "account.profile.issue.emergencyTextTooLong":
    "This can be at most {max} characters.",
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
  "directory.filter.legend": "More filters",
  "directory.filter.position": "Position",
  "directory.filter.position.all": "All positions",
  "directory.filter.position.none": "No position",
  "directory.filter.group": "Group",
  "directory.filter.group.all": "All groups",
  "directory.filter.auf": "AUF",
  "directory.filter.auf.all": "Any AUF",
  "directory.filter.auf.missing": "No AUF number",
  "directory.filter.auf.expired": "Expired",
  "directory.filter.auf.expiring": "Expires within 30 days",
  "directory.filter.auf.unverified": "Not verified",
  "directory.filter.membership": "Membership",
  "directory.filter.membership.all": "Any membership",
  "directory.filter.membership.pending": "Pending",
  "directory.filter.membership.trialing": "Trial",
  "directory.filter.membership.active": "Active",
  "directory.filter.membership.pastDue": "Payment failed",
  "directory.filter.membership.cancelled": "Cancelled",
  "directory.filter.membership.waived": "Waived",
  "directory.filter.membership.none": "No membership",
  // Los filtros de contacto (#499), de quien ve todo el contacto.
  "directory.filter.withoutPhone": "No phone",
  "directory.filter.withoutEmergencyContact": "No emergency contact",
  "directory.filter.toggle": "Filters",
  "directory.filter.toggleActive": {
    one: "Filters: {count} active",
    other: "Filters: {count} active",
  },
  "directory.filter.sheetTitle": "Filters",
  "directory.filter.apply": "Show results",
  "directory.error.filterForbidden":
    "Your role can't use one of these filters. Try again without them.",
  "directory.column.member": "Member",
  "directory.column.role": "Role",
  "directory.column.position": "Position",
  "directory.column.attendance": "Attendance",
  // El contacto de cada socio (#499), según quién mira.
  "directory.column.contact": "Contact",
  "directory.contact.email": "Email",
  "directory.contact.phone": "Phone",
  "directory.contact.emergency": "Emergency contact",
  "directory.contact.emergencyPerson": "{name} ({relationship})",
  // El porcentaje de asistencia de un miembro (#396): en el directorio, el
  // perfil propio y la ficha. El prefijo sólo lo oye un lector de pantalla.
  "memberAttendance.title": "Attendance",
  "memberAttendance.noData": "No data",
  "memberAttendance.spokenPrefix": "Attendance: ",
  "memberAttendance.sessions": {
    one: "{count} session",
    other: "{count} sessions",
  },
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
  "directory.mark.membership.none": "No membership",
  "directory.mark.membership.pending": "Membership pending",
  "directory.mark.membership.trialing": "On trial",
  "directory.mark.membership.active": "Membership active",
  "directory.mark.membership.pastDue": "Payment overdue",
  "directory.mark.membership.cancelled": "Membership cancelled",
  "directory.mark.membership.waived": "Membership waived",
  "directory.mark.notEvaluated": "Not evaluated",
  "directory.mark.notEvaluatedLabel": "Not evaluated: evaluate {name}",
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
  "memberRecord.evaluation.title": "Evaluation",
  "memberRecord.evaluation.loading": "Loading the evaluation…",
  "memberRecord.evaluation.open": "Open in Evaluations",
  "memberRecord.lead":
    "What only an Admin edits: the AUF registration, the date of birth and the groups.",
  "memberRecord.joinedOn": "Member since {date}",
  "memberRecord.photoAlt": "Photo of {name}",
  "photoViewer.open": "Open the photo of {name}",
  "photoViewer.close": "Close the photo",
  "photoViewer.alt": "Photo of {name}",
  "photoViewer.loading": "Loading the photo…",
  "photoViewer.failed": "The photo couldn't be loaded.",
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
  // El teléfono y el contacto de emergencia que corrige el Admin (#499).
  "memberRecord.contact.title": "Contact",
  "memberRecord.contact.phone": "Phone (optional)",
  "memberRecord.contact.emergencyLegend": "Emergency contact",
  "memberRecord.contact.emergencyHint":
    "Who the club calls if something happens to {name} in the water. Fill in all three, or leave them empty.",
  "memberRecord.contact.emergencyName": "Contact name",
  "memberRecord.contact.emergencyPhone": "Contact phone",
  "memberRecord.contact.emergencyRelationship": "Relationship",
  "memberRecord.contact.samePhone":
    "This is {name}'s own phone. The emergency contact should be someone else.",
  "memberRecord.groups.empty": "The club has no groups yet.",
  "memberRecord.save": "Save the record",
  "memberRecord.saving": "Saving…",
  "memberRecord.saved": "Record saved.",
  "memberRecord.issue.aufNumberTooLong":
    "The AUF number can have at most {max} characters.",
  "memberRecord.issue.aufExpiryNotADate": "That expiry isn't a valid date.",
  "memberRecord.issue.aufExpiryBeforeJoined":
    "The expiry can't be before the date they joined ({date}).",
  "memberRecord.issue.emergencyRelationshipMissing":
    "Add how they're related, or leave all three empty.",
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
  // La exportación a CSV del directorio (#500, RF-5 del PRD de E19).
  "directory.export.open": "Export CSV",
  "directory.export.emptyReason": "There are no members in the list to export.",
  "directory.export.error": "We couldn't export the list. Try again.",
  "directory.export.fileName": "directory",
  "directory.export.column.name": "Name",
  "directory.export.column.aufNumber": "AUF number",
  "directory.export.column.aufExpiry": "AUF expiry",
  "directory.export.column.aufVerified": "AUF verified",
  "directory.export.column.accountStatus": "Account status",
  "directory.export.column.membership": "Membership",
  "directory.export.column.evaluated": "Assessed",
  "directory.export.column.attendance": "Attendance (%)",
  "directory.export.column.emergencyName": "Emergency contact",
  "directory.export.column.emergencyPhone": "Emergency phone",
  "directory.export.column.emergencyRelationship": "Contact relationship",
  "directory.export.status.incomplete": "Pending activation",
  "directory.export.status.active": "Active",
  "directory.export.status.inactive": "Deactivated",
  "directory.export.yes": "Yes",
  "directory.export.no": "No",
  "directory.email.open": "Write an email",
  "directory.email.emptyReason":
    "There are no members in the list to write to.",
  "directory.email.title": "Email members",
  "directory.email.lead":
    "Each member gets their own email from the club address, and replies come to your email.",
  "directory.email.recipients": {
    one: "{count} recipient",
    other: "{count} recipients",
  },
  "directory.email.removeShort": "Remove",
  "directory.email.remove": "Remove {name}",
  "directory.email.noRecipients":
    "The list is empty: there's nobody to send it to.",
  "directory.email.subject": "Subject",
  "directory.email.message": "Message",
  "directory.email.messageHint": "Plain text, sent exactly as you write it.",
  "directory.email.error.subjectRequired": "Write a subject.",
  "directory.email.error.subjectTooLong":
    "The subject can be at most {max} characters.",
  "directory.email.error.messageRequired": "Write a message.",
  "directory.email.error.messageTooLong":
    "The message can be at most {max} characters.",
  "directory.email.send": "Send",
  "directory.email.close": "Close",
  "directory.email.confirm.title": "Send the email?",
  "directory.email.confirm.recipients": {
    one: "It goes to {count} member.",
    other: "It goes to {count} members.",
  },
  "directory.email.confirm.remaining": {
    one: "The directory has {count} email left today.",
    other: "The directory has {count} emails left today.",
  },
  "directory.email.confirm.loadingQuota":
    "Checking how many emails are left today…",
  "directory.email.confirm.quotaUnknown":
    "We couldn't check how many emails are left today.",
  "directory.email.confirm.send": "Send now",
  "directory.email.confirm.sending": "Sending…",
  "directory.email.confirm.cancel": "Cancel",
  "directory.email.result.sent": {
    one: "{count} email sent.",
    other: "{count} emails sent.",
  },
  "directory.email.result.failed": "It didn't reach:",
  "directory.email.error.quotaExceeded": {
    one: "It doesn't fit: the directory can send {count} more email today. Remove members from the list or try again later.",
    other:
      "It doesn't fit: the directory can send {count} more emails today. Remove members from the list or try again later.",
  },
  "directory.email.error.quotaExceededUnknown":
    "It doesn't fit in what the directory can still send today. Remove members from the list or try again later.",
  "directory.email.error.unavailable":
    "Sending emails isn't available right now. Try again later.",
  "directory.email.error.duplicate": "This email was already sent.",
  "directory.email.error.forbidden":
    "Your role can no longer send emails from the directory.",
  "directory.email.error.noRecipients":
    "None of the members in the list can receive it: their account may be deactivated.",
  "directory.email.error.unexpected": "We couldn't send the email. Try again.",
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
  // La exención de cuota desde la ficha (#457, RF-4 de E12).
  "membershipWaiver.title": "Membership fee",
  "membershipWaiver.lead.notWaived":
    "{name} pays the membership fee in Payments. Coaches and volunteers can be waived.",
  "membershipWaiver.lead.waived":
    "{name} doesn't pay the membership fee while the waiver lasts.",
  "membershipWaiver.reason": "Reason: {reason}",
  "membershipWaiver.until": "Ends on {date}",
  "membershipWaiver.noEndDate": "No end date",
  "membershipWaiver.waive": "Waive membership fee",
  "membershipWaiver.remove": "Remove waiver",
  "membershipWaiver.dialog.waiveTitle": "Waive {name}'s membership fee",
  "membershipWaiver.dialog.waiveLead":
    "They'll be up to date without paying. If they have a Stripe subscription, it's cancelled at the end of the period already paid.",
  "membershipWaiver.field.reason": "Reason",
  "membershipWaiver.field.reasonHint": "Required, up to 200 characters.",
  "membershipWaiver.field.until": "End date (optional)",
  "membershipWaiver.field.untilHint":
    "The waiver stops counting on this day. Leave it empty if it doesn't end.",
  "membershipWaiver.confirmWaive": "Waive fee",
  "membershipWaiver.cancel": "Cancel",
  "membershipWaiver.saving": "Saving…",
  "membershipWaiver.dialog.removeTitle": "Remove {name}'s waiver?",
  "membershipWaiver.dialog.removeLead":
    "Their membership goes back to pending, or to what's left of their Stripe subscription, which still ends at the end of its period. Until they're up to date they can't use member features.",
  "membershipWaiver.confirmRemove": "Remove waiver",
  "membershipWaiver.waived": "{name}'s membership fee is waived.",
  "membershipWaiver.removed": "{name}'s waiver was removed.",
  "membershipWaiver.error.reasonRequired": "Write the reason for the waiver.",
  "membershipWaiver.error.reasonTooLong":
    "The reason can't be longer than 200 characters.",
  "membershipWaiver.error.untilNotADate": "The end date isn't a valid day.",
  "membershipWaiver.error.untilNotAfterToday":
    "The end date has to be after today.",
  "membershipWaiver.error.notWaived":
    "This member's fee isn't waived any more. Reload the record.",
  "membershipWaiver.error.notAudited":
    "The waiver changed, but it couldn't be logged. Reload the record and tell whoever maintains the platform.",
  "membershipWaiver.error.unexpected":
    "We couldn't save the waiver. Try again.",
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
  "notifications.news_post_published.title": "New post: {category}",
  "notifications.event_created.title": "New event: {eventType}",
  "notifications.event_created.body": "{title}: {moment}",
  "notifications.event_series_created.title": "New series: {eventType}",
  "notifications.event_series_created.body":
    "{title}: {weekdays} at {time}, from {startsOn} to {endsOn}",
  "notifications.event_changed.title": "Event changed",
  "notifications.event_changed.body": "{title}: now {moment}, at {location}",
  "notifications.event_cancelled.title": "Event cancelled",
  "notifications.event_cancelled.body": "{title}: {moment}",
  "notifications.event_series_changed.title": "Series changed",
  "notifications.event_series_changed.body":
    "{title}: now {weekdays} at {time}, at {location}",
  "notifications.event_series_cancelled.title": "Series cancelled",
  "notifications.event_series_cancelled.body":
    "{title}: {weekdays} at {time}, from today on",
  "notifications.team_assigned.title": "You're playing in {team}",
  "notifications.team_assigned.body": "{title}: {moment}",
  "notifications.team_unassigned.title": "You're no longer in a team",
  "notifications.team_unassigned.body": "{title}: {moment}",
  // #470: siete días antes de cada renovación.
  "notifications.membership_renewal_upcoming.title":
    "Your membership renews soon",
  "membership.renewal.charge":
    "{amount} will be charged to your {card} on {date}.",
  "membership.renewal.chargeWithoutCard": "{amount} will be charged on {date}.",
  "membership.renewal.card": "{brand} ending in {last4}",
  "event.type.training": "Training",
  "event.type.competition": "Competition",
  "event.type.meeting": "Meeting",
  "event.type.social": "Social",
  // La agenda del Calendario (#311, RF-5 a RF-7 del PRD de E7).
  "calendar.eyebrow": "Calendar & events",
  "calendar.title": "Upcoming events",
  "calendar.loading": "Loading the events…",
  "calendar.empty": "There are no upcoming events.",
  "calendar.loadMore": "See more",
  "calendar.loadingMore": "Loading…",
  "calendar.retry": "Try again",
  "calendar.error.signInRequired":
    "Your session ended. Sign in again to see the calendar.",
  "calendar.error.unexpected": "We couldn't load the events. Try again.",
  "calendar.event.cancelled": "Cancelled",
  "calendar.event.timeAndPlace": "{time} · {location}",
  "calendar.event.going": {
    one: "{count} going",
    other: "{count} going",
  },
  "calendar.event.maybe": {
    one: "{count} maybe",
    other: "{count} maybe",
  },
  "calendar.event.counts": "{going} · {maybe}",
  "calendar.rsvp.label": "RSVP",
  "calendar.rsvp.groupLabel": "RSVP: {title}",
  "calendar.rsvp.yes": "Yes",
  "calendar.rsvp.maybe": "Maybe",
  "calendar.rsvp.no": "No",
  "calendar.rsvp.saving": "Saving…",
  "calendar.rsvp.error.network":
    "We couldn't save your answer. Check your connection and try again.",
  "calendar.rsvp.error.started":
    "This event has already started, so you can't answer anymore.",
  "calendar.rsvp.error.cancelled":
    "This event was cancelled, so you can't answer anymore.",
  "calendar.rsvp.error.notFound":
    "This event is no longer available. Reload the calendar.",
  "calendar.rsvp.error.signInRequired":
    "Your session ended. Sign in again to answer.",
  "calendar.rsvp.error.membershipNotCurrent":
    "Your membership isn't up to date. Sort it out in Payments to answer.",
  // La alerta de pago fallido en toda la aplicación (#474, RF-7 de E13).
  "failedPayment.title": "Payment failed",
  "failedPayment.dated": "Your membership payment on {date} didn't go through.",
  "failedPayment.undated": "Your last membership payment didn't go through.",
  "failedPayment.retry": "Retry payment",
  "failedPayment.error.nothingPending": "There's nothing pending to pay.",
  "failedPayment.error.stripeFailed":
    "We couldn't open the payment. Try again in a moment.",
  "membership.block.pending":
    "Your membership is pending: you haven't added a card yet.",
  "membership.block.pastDue": "Your last payment didn't go through.",
  "membership.block.cancelled": "Your membership is cancelled.",
  "membership.block.scope":
    "Until it's up to date you only see your profile, Payments and the calendar.",
  "calendar.membership.notice":
    "Your membership isn't up to date, so you can't answer events yet.",
  "calendar.membership.toPayments": "Go to Payments",
  // Pagos con el alta en Stripe Checkout (#454, RF-3 del PRD de E12).
  "payments.offer.trial":
    "Your first month is free. The first charge is in 30 days, then once a month.",
  "payments.offer.noTrial":
    "You've already had your free month, so the first charge is today, then once a month.",
  "payments.offer.stripe":
    "You add the card on Stripe: it never passes through the club's app.",
  "payments.offer.addCard": "Add card",
  "payments.offer.opening": "Opening Stripe…",
  "payments.offer.retry": "Try again",
  "payments.offer.notConfigured":
    "Payments aren't set up yet. Write to the club so an Admin can activate your membership.",
  "payments.checkout.cancelled":
    "You left Stripe without adding a card. You can try again whenever you like.",
  "payments.checkout.waiting":
    "Card added. We're waiting for Stripe to confirm it, which can take a few seconds.",
  "payments.checkout.timedOut":
    "Stripe hasn't confirmed yet. Reload the page in a minute; if your membership still hasn't changed, write to the club.",
  // Los packs de sesiones de un Casual (#471, RF-5 del PRD de E13).
  "payments.packs.title": "Session packs",
  "payments.packs.lead":
    "Each training you attend uses one session. You pay once in Stripe, with no recurring charge.",
  "payments.packs.loading": "Loading the session packs…",
  "payments.packs.loadFailed":
    "We couldn't load the session packs. Reload the page to try again.",
  "payments.packs.buy": "Buy {pack} · {price}",
  "payments.packs.waiting":
    "Pack paid. We're waiting for Stripe to confirm it, which can take a few seconds.",
  "payments.packs.paid":
    "Pack paid. Your sessions are added as soon as Stripe confirms the payment.",
  "payments.packs.cancelled":
    "You left Stripe without buying a pack. You can try again whenever you like.",
  "payments.trialing": "On trial until {date}",
  "payments.error.unavailable":
    "We couldn't open Stripe. Try again in a moment.",
  "payments.error.unexpected":
    "Something went wrong opening Stripe. Try again.",
  // El panel de membresía (#455, RF-5 y RF-7 del PRD de E12).
  "payments.loading": "Loading your membership…",
  "payments.load.failed": "We couldn't load your membership. Try again.",
  "payments.load.retry": "Try again",
  "payments.plan.title": "Current plan",
  "payments.plan.name": "{plan} membership",
  "payments.plan.monthlyPrice": "{price} a month",
  "payments.plan.priceUnavailable": "Price not available",
  "payments.plan.nextCharge": "Next charge {date}",
  "payments.plan.noRecurringCharge": "No recurring charge",
  "payments.plan.card": "{brand} ending in {last4}, expires {expiry}",
  "payments.status.active": "Active",
  "payments.status.trialing": "On trial",
  "payments.status.pending": "Pending",
  "payments.status.pastDue": "Payment failed",
  "payments.status.cancelled": "Cancelled",
  "payments.status.waived": "Waived",
  "payments.waiver.reason": "Reason: {reason}",
  "payments.waiver.until": "Until {date}",
  "payments.waiver.subscriptionEnds":
    "Your subscription ends on {date} and won't be charged again",
  "payments.card.update": "Update card",
  "payments.card.resubscribe": "Subscribe again",
  "payments.card.waiting":
    "Your new card is saved in Stripe. It shows here as soon as Stripe confirms it.",
  "payments.card.timedOut":
    "If your new card isn't shown yet, reload the page in a minute.",
  "payments.card.cancelled":
    "You left Stripe without changing your card. Your current card still works.",
  "payments.history.title": "Payment history",
  "payments.history.date": "Date",
  "payments.history.description": "Description",
  "payments.history.amount": "Amount",
  "payments.history.status": "Status",
  "payments.history.defaultDescription": "Membership payment",
  "payments.history.empty": "No payments yet.",
  "payments.history.paid": "Paid",
  "payments.history.failed": "Failed",
  "payments.history.pending": "Pending",
  "payments.sessions.left": {
    one: "You have {count} session left",
    other: "You have {count} sessions left",
  },
  "payments.sessions.empty": "Buy a pack to keep training.",
  "payments.sessions.frozen": {
    one: "Frozen balance: {count} session",
    other: "Frozen balance: {count} sessions",
  },
  "payments.sessions.frozenHint":
    "Frozen while you have a monthly plan: it counts again if you switch to Casual.",
  "payments.sessions.activity.title": "Session activity",
  "payments.sessions.activity.date": "Date",
  "payments.sessions.activity.movement": "Movement",
  "payments.sessions.activity.sessions": "Sessions",
  "payments.sessions.activity.empty": "No session activity yet.",
  "payments.sessions.activity.pack": {
    one: "Pack of {count} session",
    other: "Pack of {count} sessions",
  },
  "payments.sessions.activity.training": "Training on {date}: {title}",
  "payments.sessions.activity.trainingUnavailable": "Training session",
  "payments.choice.title": "Choose your membership",
  "payments.choice.hint": "You can change it until you pay.",
  "payments.choice.sessionPrice": "{price} per session",
  "payments.choice.trial": "First month free",
  "payments.choice.packs": "Paid in session packs",
  "payments.choice.saving": "Saving…",
  "payments.choice.failed": "We couldn't save your choice. Try again.",
  "payments.planChange.title": "Change plan",
  "payments.planChange.hint":
    "The change starts with your next billing cycle, with no proration.",
  "payments.planChange.casualHint":
    "Choosing Full or Student takes you to Stripe.",
  "payments.planChange.recurringOption": "{plan} · {price} a month",
  "payments.planChange.recurringOptionPriceUnavailable":
    "{plan} · Price not available",
  "payments.planChange.casualOption": "Casual · No recurring charge",
  "payments.planChange.confirm": "Confirm the change",
  "payments.planChange.saving": "Saving…",
  "payments.planChange.retry": "Try again",
  "payments.planChange.scheduled": "Moves to {plan} on {date}.",
  "payments.planChange.scheduledCasual":
    "Moves to Casual on {date}: your subscription ends that day.",
  "payments.planChange.cancel": "Cancel the change",
  "payments.planChange.unavailable":
    "Stripe isn't responding, so nothing changed. Try again in a moment.",
  "payments.planChange.failed":
    "We couldn't change your plan. Reload the page and try again.",
  "account.membership.title": "Membership",
  "account.membership.type": "Membership type: {plan}",
  "account.membership.none": "You haven't chosen a membership type yet.",
  "account.membership.change": "Change it in Payments",
  "calendar.rsvp.error.unexpected": "We couldn't save your answer. Try again.",
  "calendar.create.open": "Event",
  "calendar.create.created": "Event created. We let the members know.",
  "calendar.create.createdSeries": {
    one: "Created {count} session. We let the members know.",
    other: "Created {count} sessions. We let the members know.",
  },
  "calendar.edit.titleEvent": "Edit event",
  "calendar.edit.titleSeries": "Edit series",
  "calendar.edit.submit": "Save changes",
  "calendar.edit.seriesWarning":
    "These changes apply to every session from today on, including the ones that were edited on their own.",
  "calendar.manage.edit": "Edit",
  "calendar.manage.cancel": "Cancel",
  "calendar.manage.scopeQuestion.edit": "Which sessions do you want to edit?",
  "calendar.manage.scopeQuestion.cancel":
    "Which sessions do you want to cancel?",
  "calendar.manage.scope.event": "Only this one",
  "calendar.manage.scope.series": "The whole series from today on",
  "calendar.manage.back": "Back",
  "calendar.manage.cancelQuestion.event": {
    one: "{count} person said they're going. We'll let the audience know it's cancelled.",
    other:
      "{count} people said they're going. We'll let the audience know it's cancelled.",
  },
  "calendar.manage.cancelQuestion.series": {
    one: "Every session from today on will be cancelled. {count} person said they're going to this one.",
    other:
      "Every session from today on will be cancelled. {count} people said they're going to this one.",
  },
  "calendar.manage.confirm.event": "Cancel event",
  "calendar.manage.confirm.series": "Cancel series",
  "calendar.manage.cancelling": "Cancelling…",
  "calendar.manage.keep": "Keep it",
  "calendar.manage.edited": "Changes saved.",
  "calendar.manage.editedSeries": {
    one: "Changes saved to {count} session.",
    other: "Changes saved to {count} sessions.",
  },
  "calendar.manage.cancelled": "Event cancelled. We let the audience know.",
  "calendar.manage.cancelledSeries": {
    one: "Cancelled {count} session. We let the audience know.",
    other: "Cancelled {count} sessions. We let the audience know.",
  },
  "calendar.manage.closed.event_started":
    "This event has already started, so it can't be changed anymore. We refreshed the calendar.",
  "calendar.manage.closed.event_cancelled":
    "This event was already cancelled. We refreshed the calendar.",
  "calendar.manage.closed.series_without_upcoming":
    "This series has no sessions left from today on. We refreshed the calendar.",
  "calendar.manage.closed.not_found":
    "This event no longer exists. We refreshed the calendar.",
  "calendar.manage.error.forbidden": "Your role can't change events.",
  "calendar.manage.error.unexpected": "We couldn't save the change. Try again.",
  "calendar.form.title": "New event",
  "calendar.form.close": "Close",
  "calendar.form.loading": "Loading the club's groups…",
  "calendar.form.loadFailed": "We couldn't load the club's groups. Try again.",
  "calendar.form.retry": "Try again",
  "calendar.form.titleLabel": "Title",
  "calendar.form.titlePlaceholder": "e.g. Pool Training",
  "calendar.form.type": "Type",
  "calendar.form.date": "Date",
  "calendar.form.time": "Time",
  "calendar.form.location": "Location",
  "calendar.form.locationPlaceholder": "e.g. MSAC Dive Pool",
  "calendar.form.notes": "Notes",
  "calendar.form.repeat": "Repeat",
  "calendar.form.repeat.none": "One-time",
  "calendar.form.repeat.weekly": "Weekly",
  "calendar.form.weekdays": "Repeats on",
  "calendar.form.startsOn": "Starts",
  "calendar.form.endsOn": "Ends",
  "calendar.form.audience": "Who's invited",
  "calendar.form.cancel": "Cancel",
  "calendar.form.submit": "Create event",
  "calendar.form.sending": "Saving…",
  "calendar.form.issue.required": "Fill in this field.",
  "calendar.form.issue.event_title_invalid":
    "Write a title of up to {max} characters.",
  "calendar.form.issue.event_location_invalid":
    "Write a location of up to {max} characters.",
  "calendar.form.issue.event_notes_too_long":
    "The notes can be up to {max} characters long.",
  "calendar.form.issue.event_audience_empty":
    "Choose the whole club or at least one group.",
  "calendar.form.issue.event_audience_foreign_group":
    "One of these groups no longer exists. Close and open the form again.",
  "calendar.form.issue.event_in_past":
    "That date and time have already passed.",
  "calendar.form.issue.series_weekdays_empty":
    "Choose at least one day of the week.",
  "calendar.form.issue.series_range_inverted":
    "The end date is before the start date.",
  "calendar.form.issue.series_range_too_long":
    "A series can last up to {max} days.",
  "calendar.form.issue.series_without_sessions":
    "Those days and dates don't give any session. Change the days or the range.",
  "calendar.form.error.network":
    "We couldn't reach the server. Check your connection and try again.",
  "calendar.form.error.signInRequired":
    "Your session ended. Sign in again to create the event.",
  "calendar.form.error.forbidden": "Your role can't create events.",
  "calendar.form.error.unexpected": "We couldn't create the event. Try again.",
  // Próximos y pasados, y la fila desplegada (#312, RF-7 y RF-8).
  "calendar.period.label": "Which events to show",
  "calendar.period.upcoming": "Upcoming",
  "calendar.period.past": "Past",
  "calendar.pastTitle": "Past events",
  "calendar.pastEmpty": "There are no past events.",
  "calendar.detail.loading": "Loading the details…",
  "calendar.detail.notes": "Notes",
  "calendar.detail.noNotes": "This event has no notes.",
  "calendar.detail.responses": "Responses",
  "calendar.detail.noResponses": "Nobody has answered yet.",
  "calendar.detail.going": "Going",
  "calendar.detail.maybe": "Maybe",
  "calendar.detail.nobodyYet": "Nobody yet.",
  "calendar.detail.audience": "Audience",
  "calendar.detail.audience.club": "The whole club",
  "calendar.detail.audience.noGroups":
    "No groups: only Admins and the Committee see it.",
  "calendar.detail.error.notFound":
    "This event is no longer available. Reload the calendar.",
  "calendar.detail.error.unexpected": "We couldn't load this event. Try again.",
  "calendar.teams.heading": "Teams",
  "calendar.teams.playingIn":
    "You're playing in {team}, colour {color}, as {position}.",
  "calendar.teams.playingInWithoutPosition":
    "You're playing in {team}, colour {color}, with no position.",
  "calendar.teams.playingInEyebrow": "You're playing in",
  "calendar.teams.positionAndColor": "{position} · Colour: {color}",
  "calendar.teams.noPosition": "No position",
  "calendar.teams.notAssigned": "You're not in either team for this event.",
  "calendar.teams.noPlayers": "Nobody in this team yet.",
  "calendar.teams.error": "The teams could not be loaded.",
  "calendar.teams.retry": "Load the teams again",
  "calendar.teams.color.red": "red",
  "calendar.teams.color.orange": "orange",
  "calendar.teams.color.yellow": "yellow",
  "calendar.teams.color.green": "green",
  "calendar.teams.color.blue": "blue",
  "calendar.teams.color.purple": "purple",
  "calendar.teams.color.pink": "pink",
  "calendar.teams.color.black": "black",
  "calendar.teams.color.white": "white",
  "calendar.teams.color.grey": "grey",
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
  "email.directory.signature": "{name}, {role} at {clubName}, wrote to you.",
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
  "email.renewal.subject": "Your {clubName} membership renews on {date}",
  "email.renewal.changeBefore":
    "To change your card or your plan, go to Payments before then.",
  "email.renewal.button": "Go to Payments",
  "email.renewal.linkLabel": "To see your payments, open this link",
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
  "clubSettings.accent.hint":
    "A hex code such as #1C6EA4. Paste it from your brand guide or pick it on screen.",
  "clubSettings.accent.picker":
    "Pick the accent colour on screen (now {color})",
  "clubSettings.accent.previewText": "Sample text",
  "clubSettings.accent.previewLink": "Sample link",
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
  // Los textos de la pantalla de entrar que escribe el club (#301).
  "clubSettings.signInTexts.title": "Sign-in screen",
  "clubSettings.signInTexts.lead":
    "The tagline and welcome paragraph people read before they sign in. Leave a field empty to show the app's own text in that language.",
  "clubSettings.signInTexts.loading": "Loading the sign-in texts…",
  "clubSettings.signInTexts.tagline.en": "Tagline in English",
  "clubSettings.signInTexts.welcome.en": "Welcome paragraph in English",
  "clubSettings.signInTexts.tagline.es": "Tagline in Spanish",
  "clubSettings.signInTexts.welcome.es": "Welcome paragraph in Spanish",
  "clubSettings.signInTexts.hint": "Up to {max} characters. Plain text.",
  "clubSettings.signInTexts.issue.taglineTooLong":
    "The tagline can have at most {max} characters.",
  "clubSettings.signInTexts.issue.welcomeTooLong":
    "The welcome paragraph can have at most {max} characters.",
  "clubSettings.signInTexts.save": "Save sign-in texts",
  "clubSettings.signInTexts.saving": "Saving texts…",
  "clubSettings.signInTexts.saved": "Sign-in texts saved.",
  "clubSettings.sessionPacks.title": "Session packs",
  "clubSettings.sessionPacks.lead":
    "What Casual members can buy. Each pack costs the Casual session price set in Stripe, times its sessions.",
  "clubSettings.sessionPacks.loading": "Loading the session packs…",
  "clubSettings.sessionPacks.pack": {
    one: "{count} session",
    other: "{count} sessions",
  },
  "clubSettings.sessionPacks.move.up": "Move the {pack} pack up",
  "clubSettings.sessionPacks.move.down": "Move the {pack} pack down",
  "clubSettings.sessionPacks.remove": "Remove",
  "clubSettings.sessionPacks.remove.label": "Remove the {pack} pack",
  "clubSettings.sessionPacks.add.title": "Add a pack",
  "clubSettings.sessionPacks.add.label": "Sessions in the new pack",
  "clubSettings.sessionPacks.add.hint": "From {min} to {max}.",
  "clubSettings.sessionPacks.add.submit": "Add pack",
  "clubSettings.sessionPacks.moved": "{pack} is now number {rank} of {total}.",
  "clubSettings.sessionPacks.added": "{pack} pack added. Save to offer it.",
  "clubSettings.sessionPacks.removed":
    "{pack} pack removed. Save to stop offering it.",
  "clubSettings.sessionPacks.save": "Save packs",
  "clubSettings.sessionPacks.saving": "Saving…",
  "clubSettings.sessionPacks.saved": "Packs saved.",
  "clubSettings.sessionPacks.issue.required": "Keep at least one pack.",
  "clubSettings.sessionPacks.issue.outOfRange":
    "A pack has from {min} to {max} sessions.",
  "clubSettings.sessionPacks.issue.repeated":
    "There is already a pack with that many sessions.",
  "clubSettings.sessionPacks.error.forbidden":
    "Only an Admin or a Committee member can change the session packs.",
  "clubSettings.positions.title": "Positions",
  "clubSettings.positions.lead":
    "The playing positions members choose in their profile, in the order the directory follows. Archiving a position keeps it for the members who have it, but nobody else can choose it.",
  "clubSettings.positions.loading": "Loading the positions…",
  "clubSettings.positions.active.title": "Active positions",
  "clubSettings.positions.active.empty":
    "There are no active positions. Add one below or reactivate an archived one.",
  "clubSettings.positions.archived.title": "Archived positions",
  "clubSettings.positions.archived.empty": "No archived positions.",
  "clubSettings.positions.create.title": "Add a position",
  "clubSettings.positions.create.submit": "Add position",
  "clubSettings.positions.create.saving": "Adding…",
  "clubSettings.positions.rename.label": "Rename {name}",
  "clubSettings.positions.rename.submit": "Save name",
  "clubSettings.positions.rename.saving": "Saving…",
  "clubSettings.positions.cancel": "Cancel",
  "clubSettings.positions.name.en": "Name in English",
  "clubSettings.positions.name.es": "Name in Spanish",
  "clubSettings.positions.name.hint":
    "Up to {max} characters each. One language is enough: where a name is missing, the other one is shown.",
  "clubSettings.positions.language.en": "English",
  "clubSettings.positions.language.es": "Spanish",
  "clubSettings.positions.otherName": "In {language}: {name}",
  "clubSettings.positions.missingName":
    "No name in {language} yet: this one is shown instead.",
  "clubSettings.positions.move.up": "Up",
  "clubSettings.positions.move.up.label": "Move {name} up",
  "clubSettings.positions.move.down": "Down",
  "clubSettings.positions.move.down.label": "Move {name} down",
  "clubSettings.positions.rename": "Rename",
  "clubSettings.positions.archive": "Archive",
  "clubSettings.positions.archive.label": "Archive {name}",
  "clubSettings.positions.reactivate": "Reactivate",
  "clubSettings.positions.reactivate.label": "Reactivate {name}",
  "clubSettings.positions.moved": "{name} is now number {rank} of {total}.",
  "clubSettings.positions.created": "{name} added.",
  "clubSettings.positions.renamed": "Name saved.",
  "clubSettings.positions.archived":
    "{name} archived: members who have it keep it.",
  "clubSettings.positions.reactivated": "{name} can be chosen again.",
  // La función de cada posición en el auto-balance (#404). Sólo se ve aquí.
  "clubSettings.positions.coverage.hint":
    "A position's role tells the team builder whether it counts as goalkeeper, defender or forward when it balances the teams. Members never see it.",
  "clubSettings.positions.coverage.label": "Role",
  "clubSettings.positions.coverage.control.label": "Role of {name}",
  "clubSettings.positions.coverage.none": "No role",
  "clubSettings.positions.coverage.goalkeeper": "Goalkeeper",
  "clubSettings.positions.coverage.defender": "Defender",
  "clubSettings.positions.coverage.forward": "Forward",
  "clubSettings.positions.coverage.save": "Save",
  "clubSettings.positions.coverage.save.label": "Save role of {name}",
  "clubSettings.positions.coverage.saving": "Saving…",
  "clubSettings.positions.coverage.saved": "{name} now counts as {coverage}.",
  "clubSettings.positions.coverage.cleared":
    "{name} no longer counts as any role.",
  "clubSettings.positions.retry": "Try again",
  "clubSettings.positions.reloadLatest": "Load the latest positions",
  "clubSettings.positions.issue.nameRequired":
    "Give the position a name in at least one language.",
  "clubSettings.positions.issue.nameTooLong": "Up to {max} characters.",
  "clubSettings.positions.issue.nameTaken":
    "Another position already has this name.",
  "clubSettings.positions.error.changed":
    "Another Admin changed the positions while you were editing them. Load the latest and try again.",
  // Noticias (#329): el feed y la publicación abierta.
  "news.metaTitle": "News · {club}",
  "news.metaDescription": "What the club has published for you.",
  "news.eyebrow": "News & documents",
  "news.title": "Club feed",
  "news.loading": "Loading the news…",
  "news.empty": "Nothing has been published for you yet.",
  "news.loadMore": "Load more",
  "news.loadingMore": "Loading…",
  "news.retry": "Try again",
  "news.category.announcement": "Announcement",
  "news.category.news": "News",
  "news.category.document": "Document",
  "news.attachmentCount": {
    one: "{count} attachment",
    other: "{count} attachments",
  },
  "news.error.signInRequired":
    "Your session ended. Sign in again to see the news.",
  "news.error.unexpected": "We couldn't load the news. Try again.",
  "news.post.back": "← Back to News",
  "news.post.loading": "Loading the post…",
  "news.post.published": "Published {date}",
  "news.post.edited": "Edited {date}",
  "news.post.withdrawn": "Withdrawn",
  "news.post.attachments": "Attachments",
  "news.post.download": "Download",
  "news.post.unavailable": "{name} is no longer available.",
  "news.post.notFound.title": "This post doesn't exist",
  "news.post.notFound.lead": "Check the address, or go back to News.",
  "news.post.error.unexpected": "We couldn't open the post. Try again.",
  // El formulario de publicar (#330).
  "news.publish": "+ Publish",
  "news.publish.metaTitle": "Publish · {club}",
  "news.publish.metaDescription":
    "Write a post for the club, choose who sees it and attach documents.",
  "news.publish.back": "← Back to News",
  "news.publish.title": "New post",
  "news.publish.lead":
    "Write it, choose who sees it and attach any documents. It goes to the top of the feed as soon as you publish.",
  "news.publish.loading": "Loading the club's groups…",
  "news.publish.loadFailed": "We couldn't load the club's groups. Try again.",
  "news.publish.category": "Category",
  "news.publish.titleLabel": "Title",
  "news.publish.titleHint": "Up to {max} characters.",
  "news.publish.body": "Message",
  "news.publish.bodyHint": "Plain text. Line breaks are kept.",
  "news.publish.audience.legend": "Who sees it",
  "audience.club": "The whole club",
  "audience.groups": "Specific groups",
  "audience.groupsLegend": "Groups",
  "audience.noGroups":
    "The club has no groups yet, so this can only go to the whole club.",
  "news.publish.attachments.legend": "Attachments",
  "news.publish.attachments.hint":
    "Up to {max} files of {size} MB each: PDF, JPEG, PNG, WebP or Word.",
  "news.publish.attachments.choose": "Choose files",
  "news.publish.attachments.add": "Add files",
  "news.publish.attachments.uploading": "Uploading…",
  "news.publish.attachments.remove": "Remove",
  "news.publish.attachments.removeNamed": "Remove {name}",
  "news.publish.attachments.notice": "{name}: {reason}",
  "news.publish.attachments.removeFailed": "We couldn't remove it. Try again.",
  "news.publish.attachments.issue.empty": "The file is empty.",
  "news.publish.attachments.issue.tooLarge": "Each file can be up to {max} MB.",
  "news.publish.attachments.issue.typeUnsupported":
    "Only PDF, images (JPEG, PNG, WebP) and Word documents.",
  "news.publish.attachments.issue.typeMismatch":
    "The file's extension doesn't match what's inside it.",
  "news.publish.attachments.issue.nameInvalid":
    "The file name isn't valid. Rename it and try again.",
  "news.publish.attachments.issue.limitReached":
    "A post can have at most {max} attachments.",
  "news.publish.attachments.issue.uploadMissing":
    "An attachment is no longer uploaded. Remove it and attach it again.",
  "news.publish.issue.titleMissing": "Give the post a title.",
  "news.publish.issue.titleTooLong":
    "The title can have up to {max} characters.",
  "news.publish.issue.bodyMissing": "Write the message.",
  "news.publish.issue.audienceGroupsEmpty":
    "Choose at least one group, or send it to the whole club.",
  "news.publish.submit": "Publish",
  "news.publish.sending": "Publishing…",
  "news.publish.waitForUploads":
    "Wait for the attachments to finish uploading.",
  "news.publish.error.network":
    "We couldn't reach the server. Nothing was published: check your connection and try again.",
  "news.publish.error.signInRequired":
    "Your session ended. Sign in again to publish.",
  "news.publish.error.forbidden": "Your role can't publish news.",
  "news.publish.error.unexpected": "We couldn't publish it. Try again.",
  "evaluations.metaTitle": "Evaluations · {club}",
  "evaluations.title": "Evaluations",
  "evaluations.lead":
    "Each member's ratings and their OVR. Only coaches and admins see them.",
  "evaluations.loading": "Loading the club's evaluations…",
  "evaluations.retry": "Try again",
  "evaluations.list.title": "Members",
  "evaluations.search.label": "Search by name",
  "evaluations.search.placeholder": "Member's name",
  "evaluations.list.empty": "There's nobody in the club to evaluate yet.",
  "evaluations.list.noMatches": "No member matches that name.",
  "evaluations.list.notEvaluated": "Not evaluated",
  "evaluations.notEvaluatedYet": "No evaluation yet.",
  "evaluations.list.noRatings": "No ratings yet",
  "evaluations.list.overall": "OVR {rating}",
  "evaluations.sheet.label": "Evaluation of {name}",
  "evaluations.sheet.eyebrow": "Player evaluation",
  "evaluations.sheet.back": "All members",
  "evaluations.sheet.placeholder":
    "Choose a member from the list to see their evaluation.",
  "evaluations.sheet.loading": "Loading the evaluation…",
  "evaluations.overall.title": "Overall score",
  "evaluations.overall.outOf": "/ {max}",
  "evaluations.overall.noData": "No data",
  "evaluations.ratings.title": "Skill ratings",
  "evaluations.ratings.outOf": " out of {max}",
  "evaluations.ratings.retired": "Retired",
  "evaluations.notEvaluated.title": "{name} has no evaluation yet.",
  "evaluations.notEvaluated.hint":
    "When you create it, every category starts at 5.",
  "evaluations.create": "Create evaluation",
  "evaluations.creating": "Creating…",
  "evaluations.edit": "Edit ratings",
  "evaluations.save": "Save ratings",
  "evaluations.saving": "Saving…",
  "evaluations.cancel": "Cancel",
  "evaluations.saved": "Ratings saved.",
  "evaluations.reload": "Reload evaluation",
  "evaluations.error.changed":
    "Someone else changed this evaluation while you were editing. Reload it to see their changes.",
  "evaluations.error.exists":
    "Someone else just created this evaluation. Reload it to see it.",
  "evaluations.error.memberNotFound": "That member is no longer in the club.",
  "evaluations.error.memberInactive":
    "That member's account is deactivated, so they can't be evaluated.",
  "evaluations.error.noActiveCategories":
    "The club has no active categories. Add or reactivate one before evaluating.",
  "evaluations.error.signInRequired":
    "Your session ended. Sign in again to see evaluations.",
  "evaluations.error.forbidden": "Only coaches and admins can see evaluations.",
  "evaluations.error.unexpected": "Something went wrong. Try again.",
  "evaluations.refresh.hint":
    "The club's categories have changed since this evaluation was made.",
  "evaluations.refresh.action": "Update to the current categories",
  "evaluations.refresh.running": "Updating…",
  "evaluations.refresh.done":
    "This evaluation now uses the current categories.",
  "evaluations.categories.link": "Categories",
  "evaluations.categories.metaTitle": "Evaluation categories · {club}",
  "evaluations.categories.title": "Evaluation categories",
  "evaluations.categories.lead":
    "What every evaluation measures, in the order it's shown. Saved evaluations keep their categories until you update them.",
  "evaluations.categories.back": "Evaluations",
  "evaluations.categories.loading": "Loading the categories…",
  "evaluations.categories.active.title": "Active categories",
  "evaluations.categories.active.empty":
    "No active categories. New evaluations need at least one.",
  "evaluations.categories.inactive.title": "Deactivated categories",
  "evaluations.categories.inactive.empty": "No deactivated categories.",
  "evaluations.categories.create.title": "Add a category",
  "evaluations.categories.create.submit": "Add category",
  "evaluations.categories.create.saving": "Adding…",
  "evaluations.categories.name.label": "Category name",
  "evaluations.categories.name.hint": "Up to {max} characters.",
  "evaluations.categories.rename": "Rename",
  "evaluations.categories.rename.label": "Rename {name}",
  "evaluations.categories.rename.submit": "Save name",
  "evaluations.categories.rename.saving": "Saving…",
  "evaluations.categories.cancel": "Cancel",
  "evaluations.categories.move.up": "Up",
  "evaluations.categories.move.up.label": "Move {name} up",
  "evaluations.categories.move.down": "Down",
  "evaluations.categories.move.down.label": "Move {name} down",
  "evaluations.categories.deactivate": "Deactivate",
  "evaluations.categories.deactivate.label": "Deactivate {name}",
  "evaluations.categories.reactivate": "Reactivate",
  "evaluations.categories.reactivate.label": "Reactivate {name}",
  "evaluations.categories.moved": "{name} is now number {rank} of {total}.",
  "evaluations.categories.created": "{name} added.",
  "evaluations.categories.renamed": "Name saved.",
  "evaluations.categories.deactivated":
    "{name} is deactivated. New evaluations won't include it.",
  "evaluations.categories.reactivated":
    "{name} is active again. New evaluations include it.",
  "evaluations.categories.retry": "Try again",
  "evaluations.categories.reloadLatest": "Load the latest categories",
  "evaluations.categories.issue.nameRequired": "Write a name for the category.",
  "evaluations.categories.issue.nameTooLong": "Up to {max} characters.",
  "evaluations.categories.issue.nameTaken":
    "Another category already has this name.",
  "evaluations.categories.error.changed":
    "Someone else changed the categories in the meantime. Load the latest ones and try again.",
  "evaluations.categories.error.notFound":
    "That category no longer exists. Load the latest categories.",
  "news.post.edit": "Edit",
  "news.post.withdraw": "Withdraw",
  "news.post.withdrawQuestion":
    "Withdraw this post? It disappears from everyone's feed and its attachments stop being available. It isn't deleted: you can publish it again later.",
  "news.post.withdrawConfirm": "Withdraw post",
  "news.post.withdrawing": "Withdrawing…",
  "news.post.cancel": "Cancel",
  "news.post.republish": "Publish again",
  "news.post.republishing": "Publishing…",
  "news.post.error.withdraw": "We couldn't withdraw it. Try again.",
  "news.post.error.republish": "We couldn't publish it again. Try again.",
  "news.edit.metaTitle": "Edit post · {club}",
  "news.edit.metaDescription": "Correct a post you published.",
  "news.edit.back": "← Back to the post",
  "news.edit.title": "Edit post",
  "news.edit.lead":
    "Saving doesn't notify anyone. The post will show that it was edited, and when.",
  "news.edit.loading": "Loading the post…",
  "news.edit.loadFailed": "We couldn't load the post. Try again.",
  "news.edit.forbidden": "You can only edit your own posts.",
  "news.edit.submit": "Save changes",
  "news.edit.sending": "Saving…",
  "news.edit.error.conflict":
    "Someone else saved this post while you were editing it. Reload the page to see their changes before saving yours.",
  "news.edit.error.unexpected": "We couldn't save the changes. Try again.",
  "attendance.metaTitle": "Attendance · {club}",
  "attendance.eyebrow": "Attendance",
  "attendance.title": "{title} · {date}",
  "attendance.loading": "Loading the sessions…",
  "attendance.loadingSheet": "Loading the attendance sheet…",
  "attendance.retry": "Try again",
  "attendance.sessions.label": "Sessions",
  "attendance.sessions.choice": "{weekday} {day} · {title}",
  "attendance.noSessions": "No training has started in the last 30 days.",
  "attendance.toCalendar": "Go to the calendar",
  "attendance.totals.label": "Totals",
  "attendance.group.yes": "Confirmed",
  "attendance.group.maybe": "Maybe",
  "attendance.group.none": "No response",
  "attendance.group.no": "Said no",
  "attendance.status.present": "Present",
  "attendance.status.late": "Late",
  "attendance.status.absent": "Absent",
  "attendance.emptySheet": "Nobody is expected at this session.",
  "attendance.inactive": "Deactivated",
  "attendance.save": "Save attendance",
  "attendance.unsaved": "Unsaved changes",
  "attendance.saving": "Saving…",
  "attendance.saved":
    "Attendance saved: {present} present, {late} late, {absent} absent.",
  "attendance.discardQuestion":
    "You have unsaved changes on this session. Discard them?",
  "attendance.error.notStarted":
    "This training hasn't started yet: attendance opens at its start time.",
  "attendance.error.cancelled":
    "This training was cancelled: it doesn't take attendance.",
  "attendance.error.outsideSheet":
    "Someone on the list is no longer expected at this session. Reload the page and try again.",
  "attendance.error.notFound":
    "That session doesn't exist or isn't a training.",
  "attendance.error.signInRequired":
    "Your session ended. Sign in again to take attendance.",
  "attendance.error.forbidden": "Only Admins and Coaches take attendance.",
  "attendance.error.unexpected": "Something went wrong. Try again.",
  "calendar.takeAttendance": "Take attendance",
  "teams.metaTitle": "Teams · {club}",
  "teams.eyebrow": "Team builder",
  "teams.lead":
    "Auto-balance splits the squad by overall score and checks position coverage, so both teams field a keeper, defenders and forwards of similar strength.",
  "teams.title": "{day} · {title}",
  "teams.loading": "Loading the events…",
  "teams.loadingSquad": "Loading the squad…",
  "teams.retry": "Try again",
  "teams.noEvents":
    "There are no trainings or competitions coming up to build teams for.",
  "teams.toCalendar": "Go to the calendar",
  "teams.event.label": "Event",
  "teams.event.choice": "{day} · {time} · {title}",
  "teams.mode.label": "Mode",
  "teams.mode.manual": "Manual",
  "teams.mode.auto": "Auto-balance",
  "teams.balance": "Balance teams",
  "teams.balancing": "Balancing…",
  "teams.totals.label": "Totals",
  "teams.totals.team": "{team} · {points} pts",
  "teams.totals.difference": "Difference {difference}",
  "teams.column.average": "Avg {average}",
  "teams.column.players": {
    one: "{count} player",
    other: "{count} players",
  },
  "teams.column.empty": "No one on this team yet.",
  "teams.available.title": "Available",
  "teams.available.empty": "Nobody else has said Yes.",
  "teams.maybe.title": "Maybe",
  "teams.maybe.empty": "Nobody else has said Maybe.",
  "teams.player.unrated": "Unrated",
  "teams.player.outside": "No longer coming",
  "teams.move.to": "To {team}",
  "teams.move.toNamed": "Move {player} to {team}",
  "teams.move.switch": "Switch",
  "teams.move.switchNamed": "Switch {player} to {team}",
  "teams.move.remove": "Remove",
  "teams.move.removeNamed": "Remove {player} from {team}",
  "teams.announce.moved": "{player} moved to {list}.",
  "teams.announce.removed": "{player} is off the teams.",
  "teams.announce.swapped": "{first} and {second} swapped teams.",
  "teams.announce.totals":
    "{teamA} {pointsA} points, {teamB} {pointsB} points, difference {difference}.",
  "teams.suggestion.title": "Suggested swap",
  "teams.suggestion.coverage":
    "{first} ↔ {second}, to cover the positions on both teams.",
  "teams.suggestion.rating":
    "{first} ↔ {second}, to bring the difference down to {difference}.",
  "teams.suggestion.apply": "Apply",
  "teams.save": "Save",
  "teams.saving": "Saving…",
  "teams.unsaved": "Unsaved changes",
  "teams.saved": "Teams saved as a draft. Nobody has been notified yet.",
  "teams.balanced": "Teams balanced and saved as a draft.",
  "teams.publish": "Publish teams",
  "teams.publishing": "Publishing…",
  "teams.publishQuestion": {
    one: "Publish the teams? {count} player will get a notification with their team.",
    other:
      "Publish the teams? {count} players will get a notification with their team.",
  },
  "teams.republishQuestion": {
    one: "Publish the changes? Of the {count} player on the teams, only someone who joins, leaves or changes team gets a notification.",
    other:
      "Publish the changes? Of the {count} players on the teams, only those who join, leave or change team get a notification.",
  },
  "teams.publishConfirm": "Publish and notify",
  "teams.publishCancel": "Not yet",
  "teams.published": {
    one: "Teams published. {count} player notified.",
    other: "Teams published. {count} players notified.",
  },
  "teams.discardQuestion":
    "You have unsaved changes on these teams. Discard them?",
  "teams.error.notBuildable": "Only trainings and competitions have teams.",
  "teams.error.cancelled":
    "This event was cancelled: its teams can no longer be changed.",
  "teams.error.past": "This event is over: its teams can no longer be changed.",
  "teams.error.squadEmpty":
    "Nobody has said Yes to this event: there is no one to balance.",
  "teams.error.splitEmpty": "Put at least one player on a team to publish.",
  "teams.error.outsideSquad":
    "Someone on the teams is no longer coming. Remove the players marked “No longer coming” and try again.",
  "teams.error.notFound": "That event doesn't exist.",
  "teams.error.signInRequired":
    "Your session ended. Sign in again to build teams.",
  "teams.error.forbidden": "Only Admins and Coaches build teams.",
  "teams.error.unexpected": "Something went wrong. Try again.",
  "search.label": "Search",
  "search.placeholder": "Search members, events, news…",
  "search.results": "Search results",
  "search.group.members": "Members",
  "search.group.events": "Events",
  "search.group.news": "News",
  "search.groupLabel": "{group} ({total})",
  "search.seeAll.members": "See all members",
  "search.seeAll.events": "See all events",
  "search.seeAll.news": "See all news",
  "search.event.cancelled": "Cancelled",
  "search.loading": "Searching…",
  "search.empty": "Nothing matches “{text}”",
  "search.error": "We couldn't search. Check your connection and try again.",
  "search.retry": "Try again",
  "search.announcement": {
    one: "{count} result",
    other: "{count} results",
  },
  "search.open": "Search",
  "search.close": "Close search",
} as const satisfies Readonly<Record<string, Message>>;
