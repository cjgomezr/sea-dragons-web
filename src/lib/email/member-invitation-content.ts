import type { Translator } from "@/lib/i18n/translator";

/**
 * Lo que dice la invitación de un miembro (#243, FR-021), sin el HTML ni la
 * marca alrededor. Lo comparten el correo que se manda y la vista previa del
 * panel de invitar (#862), para que el Admin lea exactamente lo que va a
 * recibir el socio.
 */

export type MemberInvitationContent = {
  readonly subject: string;
  readonly intro: readonly string[];
  readonly buttonLabel: string;
  readonly linkLabel: string;
  readonly outro: readonly string[];
};

export function memberInvitationContent(
  t: Translator,
  {
    clubName,
    linkLifetimeMinutes,
  }: { readonly clubName: string; readonly linkLifetimeMinutes: number },
): MemberInvitationContent {
  return {
    subject: t("email.invitation.subject", { clubName }),
    intro: [
      t("email.invitation.invited", { clubName }),
      t("email.invitation.nextSteps"),
      t("email.invitation.linkLifetime", { count: linkLifetimeMinutes }),
    ],
    buttonLabel: t("email.invitation.button"),
    linkLabel: t("email.invitation.linkLabel"),
    outro: [t("email.invitation.ifExpired"), t("email.invitation.notYou")],
  };
}
