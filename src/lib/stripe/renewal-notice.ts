import type { ClubBrand } from "@/lib/club/club-brand";
import type { EmailDeliveryAvailabilityCheck } from "@/lib/email/email-delivery-availability";
import { FALLBACK_EMAIL_LOCALE } from "@/lib/email/email-locale";
import { renderRenewalReminderEmail } from "@/lib/email/email-templates";
import type { EmailSenderConnection } from "@/lib/email/resend-email-sender";
import { isLocale } from "@/lib/i18n/locale";
import type { RenewalCharge } from "@/lib/membership/renewal-charge";
import {
  type NotificationWriter,
  notifyMember,
} from "@/lib/notifications/notify-member";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import type { RenewalNotice } from "./webhook-events";

/**
 * El aviso de renovación (#470, RF-8 del PRD de E13, D3): uno en la campana y
 * un correo, cada uno por su lado. Cuando esto corre el webhook ya apuntó el
 * evento, así que nada de aquí puede lanzar: Stripe no reintentaría un evento
 * que la base ya da por aplicado, y el aviso se perdería igual.
 */

/** Lo que el webhook le pide al aviso de renovación. No lanza. */
export type RenewalNoticeSender = {
  notifyUpcomingRenewal(notice: RenewalNotice): Promise<void>;
};

/** Lanza si el correo no sale, por el motivo que sea. */
export type RenewalEmailGateway = {
  sendRenewalEmail(notice: RenewalNotice): Promise<void>;
};

/** La dirección y el idioma guardados en la fila del socio. */
export type RenewalEmailRecipient = {
  readonly email: string;
  readonly emailLocale: string | null;
};

export type RenewalEmailRecipients = {
  /** `null` si el socio ya no tiene fila. */
  findRecipient(userId: string): Promise<RenewalEmailRecipient | null>;
};

const LOG_PREFIX = "[stripe/renewal-notice]";

function toRenewalCharge(notice: RenewalNotice): RenewalCharge {
  return {
    amountCents: notice.amountCents,
    chargeOn: clubCalendarDate(notice.chargeAt),
    card: notice.card,
  };
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function createRenewalNoticeSender(dependencies: {
  readonly notifications: NotificationWriter;
  readonly email: RenewalEmailGateway;
  readonly log: (line: string) => void;
}): RenewalNoticeSender {
  const { notifications, email, log } = dependencies;
  return {
    async notifyUpcomingRenewal(notice) {
      // `notifyMember` no lanza: un aviso que no se guarda ya lo registra él.
      await notifyMember(notifications, {
        recipientUserId: notice.userId,
        type: "membership_renewal_upcoming",
        data: toRenewalCharge(notice),
      });
      try {
        await email.sendRenewalEmail(notice);
      } catch (error) {
        log(
          `${LOG_PREFIX} el correo de renovación del socio ${notice.userId} no salió: ${describeCause(error)}`,
        );
      }
    },
  };
}

/** Sin conexión no se gasta cupo: el cupo cuenta peticiones que podían
 * salir. El socio se lee antes por lo mismo. */
export function createRenewalEmailGateway(dependencies: {
  readonly emails: EmailSenderConnection;
  /** El cupo propio de correos (migración 0009), que firma cada petición con
   * el club del socio (NFR-009). */
  readonly availabilityForClub: (
    clubId: string,
  ) => EmailDeliveryAvailabilityCheck;
  readonly recipients: RenewalEmailRecipients;
  /** Nunca lanza: si la base no contesta, da la marca de respaldo. */
  readonly readClubBrand: () => Promise<ClubBrand>;
  readonly paymentsUrl: string;
  readonly now: () => Date;
}): RenewalEmailGateway {
  const { emails, recipients } = dependencies;
  return {
    async sendRenewalEmail(notice) {
      if (emails.kind === "not_connected") {
        throw new Error(emails.reason);
      }
      const recipient = await recipients.findRecipient(notice.userId);
      if (recipient === null) {
        throw new Error(`El socio ${notice.userId} no tiene fila en members.`);
      }
      const availability = await dependencies
        .availabilityForClub(notice.clubId)
        .checkAvailability(dependencies.now());
      if (availability.kind === "unavailable") {
        throw new Error(availability.reason);
      }
      await emails.sender.sendEmail({
        to: recipient.email,
        ...renderRenewalReminderEmail({
          renewal: toRenewalCharge(notice),
          paymentsUrl: dependencies.paymentsUrl,
          locale: isLocale(recipient.emailLocale)
            ? recipient.emailLocale
            : FALLBACK_EMAIL_LOCALE,
          brand: await dependencies.readClubBrand(),
        }),
      });
    },
  };
}
