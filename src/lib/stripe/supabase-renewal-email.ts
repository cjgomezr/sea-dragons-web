import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { PAYMENTS_PATH } from "@/lib/auth/routes";
import { readClubBrand } from "@/lib/club/supabase-club-brand";
import { createEmailDeliveryAvailabilityCheck } from "@/lib/email/email-delivery-availability";
import {
  connectResendEmailSender,
  createResendProviderProbe,
} from "@/lib/email/resend-email-sender";
import { createSupabaseEmailSendBudget } from "@/lib/email/supabase-email-send-budget";
import {
  type RenewalEmailGateway,
  type RenewalEmailRecipients,
  createRenewalEmailGateway,
} from "./renewal-notice";

/**
 * Raíz de composición del correo de renovación (#470). Va por la llave de
 * servicio: quien llama es el webhook de Stripe, sin sesión de nadie.
 */

type Environment = Readonly<Record<string, string | undefined>>;

const MEMBERS_TABLE = "members";

const recipientRowSchema = z.object({
  email: z.string().min(1),
  email_locale: z.string().nullable(),
});

function createRenewalEmailRecipients(
  serviceClient: SupabaseClient,
): RenewalEmailRecipients {
  return {
    async findRecipient(userId) {
      const { data, error } = await serviceClient
        .from(MEMBERS_TABLE)
        .select("email, email_locale")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        throw new Error(
          `No se pudo leer el correo del socio ${userId}: ${error.message}`,
        );
      }
      if (data === null) {
        return null;
      }
      const row = recipientRowSchema.parse(data);
      return { email: row.email, emailLocale: row.email_locale };
    },
  };
}

/** `appUrl` es el origen de la propia petición del webhook: Pagos vive en el
 * mismo despliegue. */
export function createSupabaseRenewalEmailGateway(
  serviceClient: SupabaseClient,
  input: { readonly env: Environment; readonly appUrl: string },
): RenewalEmailGateway {
  const emails = connectResendEmailSender(input.env);
  return createRenewalEmailGateway({
    emails,
    availabilityForClub: (clubId) =>
      createEmailDeliveryAvailabilityCheck({
        connection: emails,
        provider: createResendProviderProbe(input.env),
        budget: createSupabaseEmailSendBudget(serviceClient, clubId),
      }),
    recipients: createRenewalEmailRecipients(serviceClient),
    readClubBrand,
    paymentsUrl: new URL(PAYMENTS_PATH, input.appUrl).toString(),
    now: () => new Date(),
  });
}
