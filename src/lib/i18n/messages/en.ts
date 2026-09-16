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

  "auth.signIn.metaTitle": "Sign in · Victoria Seadragons",
  "auth.signIn.metaDescription":
    "Sign in to the Victoria Seadragons underwater rugby club platform.",
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

  "auth.registration.metaTitle": "Create your account · Victoria Seadragons",
  "auth.registration.metaDescription":
    "Sign up to the Victoria Seadragons underwater rugby club platform.",
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

  "auth.completion.metaTitle": "Finish signing up · Victoria Seadragons",
  "auth.completion.metaDescription":
    "Fill in the details your Victoria Seadragons club account is missing.",
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
    "I am their parent or legal guardian and I consent to the Victoria Seadragons club processing the data in this account.",
  "auth.guardian.submit": "Record consent",

  "auth.passwordRecovery.metaTitle":
    "Reset your password · Victoria Seadragons",
  "auth.passwordRecovery.metaDescription":
    "Ask for a link to choose a new password on the Victoria Seadragons club platform.",
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

  "auth.newPassword.metaTitle":
    "Choose your new password · Victoria Seadragons",
  "auth.newPassword.metaDescription":
    "Choose a new password for your Victoria Seadragons club account.",
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
  "signOut.label": "Sign out",
  // El destino va con su propio nombre ("Español", no "Spanish"): quien no
  // entiende el idioma de la pantalla tiene que reconocer el suyo. Y el
  // nombre repite el código que se ve en el botón, para que quien lo maneja
  // con la voz pueda decir "ES" (WCAG 2.5.3).
  "languageToggle.label": "Language: English. Switch to Español (ES)",
  "languageToggle.target": "ES",
} as const satisfies Readonly<Record<string, Message>>;
