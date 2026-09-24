import { toConfirmationEmailOutcome } from "@/lib/auth/confirmation-email-sender";
import {
  RECOVERY_LINK_LIFETIME_MINUTES,
  type RecoveryTokenIssue,
  type RecoveryTokenIssuer,
  buildPasswordResetUrl,
} from "@/lib/auth/password-recovery";
import type {
  ConfirmationEmailGateway,
  ConfirmationEmailOutcome,
} from "@/lib/auth/register-member";
import type { ClubBrand } from "@/lib/club/club-brand";
import {
  type EmailLocaleDirectory,
  readEmailLocale,
} from "@/lib/email/email-locale";
import { renderMemberInvitationEmail } from "@/lib/email/email-templates";
import { describeErrorWithoutEmail } from "@/lib/email/redact-email";
import {
  EmailDeliveryError,
  type EmailSender,
  type EmailSenderConnection,
} from "@/lib/email/resend-email-sender";

/**
 * El correo de la invitación de un miembro dado de alta por un Admin (#243,
 * FR-021). Tiene la forma del correo de confirmación para que el reenvío pase
 * por el mismo límite (`resendConfirmationEmail`).
 *
 * El enlace es el de elegir contraseña nueva: la identidad nace sin ninguna, y
 * canjear ese enlace confirma además el correo (comprobado contra
 * seadragons-dev el 22 de septiembre de 2026).
 */

type InvitationEmail = {
  readonly to: string;
  readonly acceptUrl: string;
  readonly userId: string;
  readonly brand: ClubBrand;
};

/** El alta ya creó al miembro cuando esto corre, así que un fallo al emitir el
 * enlace no puede subir como error: la pantalla tiene que decir que la
 * invitación no salió y ofrecer reenviarla. */
async function issueToken(
  tokens: RecoveryTokenIssuer,
  email: string,
): Promise<
  RecoveryTokenIssue | { readonly kind: "failed"; readonly reason: string }
> {
  try {
    return await tokens.issueRecoveryToken(email);
  } catch (error) {
    return {
      kind: "failed",
      reason: describeErrorWithoutEmail(error, email),
    };
  }
}

/** Sólo un fallo de entrega es un resultado; cualquier otro error es un bug. */
async function deliverInvitation(
  sender: EmailSender,
  emailLocales: EmailLocaleDirectory,
  invitation: InvitationEmail,
): Promise<ConfirmationEmailOutcome> {
  const locale = await readEmailLocale(emailLocales, invitation.userId);
  try {
    await sender.sendEmail({
      to: invitation.to,
      ...renderMemberInvitationEmail({
        acceptUrl: invitation.acceptUrl,
        linkLifetimeMinutes: RECOVERY_LINK_LIFETIME_MINUTES,
        locale,
        brand: invitation.brand,
      }),
    });
    return { kind: "requested" };
  } catch (error) {
    if (!(error instanceof EmailDeliveryError)) {
      throw error;
    }
    return toConfirmationEmailOutcome(error, invitation.to);
  }
}

export function createInvitationEmailGateway(dependencies: {
  readonly tokens: RecoveryTokenIssuer;
  readonly emails: EmailSenderConnection;
  readonly emailLocales: EmailLocaleDirectory;
  /** Nunca lanza: si la base no contesta, da la marca de respaldo. */
  readonly readClubBrand: () => Promise<ClubBrand>;
}): ConfirmationEmailGateway {
  const { tokens, emails, emailLocales, readClubBrand } = dependencies;
  return {
    async requestConfirmationEmail(email, appUrl) {
      // Antes de emitir: un enlace nuevo invalida el anterior, y emitirlo sin
      // poder mandarlo rompería el que el miembro ya tuviera.
      if (emails.kind === "not_connected") {
        return { kind: "failed", reason: emails.reason };
      }
      const issue = await issueToken(tokens, email);
      if (issue.kind === "no_account") {
        return { kind: "not_requested" };
      }
      if (issue.kind === "failed") {
        return issue;
      }
      return deliverInvitation(emails.sender, emailLocales, {
        to: email,
        acceptUrl: buildPasswordResetUrl(appUrl, issue.tokenHash),
        userId: issue.userId,
        brand: await readClubBrand(),
      });
    },
  };
}
