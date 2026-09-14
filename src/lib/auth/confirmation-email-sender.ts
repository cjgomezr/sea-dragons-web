import { renderAccountConfirmationEmail } from "@/lib/email/email-templates";
import {
  EmailDeliveryError,
  type EmailSender,
  type EmailSenderConnection,
} from "@/lib/email/resend-email-sender";
import {
  EMAIL_CONFIRMATION_LINK_LIFETIME_MINUTES,
  buildEmailConfirmationUrl,
} from "./email-confirmation";
import type {
  ConfirmationEmailGateway,
  ConfirmationEmailOutcome,
  RequestedConfirmationEmail,
} from "./register-member";

/**
 * El correo de confirmación de cuenta, mandado por el proveedor de correo del
 * proyecto y no por el servicio incorporado de Supabase, que corta a 2
 * mensajes por hora (#137). Supabase sólo emite el enlace; el correo es
 * nuestro.
 */

/** Un 429 es el proveedor agotando su cupo. El código se mira además del
 * estado por si una versión futura cambia uno de los dos. */
const RATE_LIMITED_STATUS = 429;
const EMAIL_RATE_LIMIT_CODE = "over_email_send_rate_limit";

/** Los motivos a veces citan la dirección ("Email address ... is invalid"), y
 * los registros del servidor no son sitio para datos personales. */
const REDACTED_EMAIL = "<correo>";

/** Lo mínimo que tiene cualquier fallo de envío: el de Supabase Auth al emitir
 * el enlace y el del proveedor al mandarlo. */
export type SendFailure = {
  readonly status?: number | undefined;
  readonly code?: string | undefined;
  readonly message: string;
};

function describeSendFailure(failure: SendFailure, email: string): string {
  const message = failure.message.replaceAll(email, REDACTED_EMAIL);
  return failure.status === undefined
    ? message
    : `${failure.status}: ${message}`;
}

export function toConfirmationEmailOutcome(
  failure: SendFailure | null,
  email: string,
): RequestedConfirmationEmail {
  if (failure === null) {
    return { kind: "requested" };
  }
  const reason = describeSendFailure(failure, email);
  const isRateLimited =
    failure.status === RATE_LIMITED_STATUS ||
    failure.code === EMAIL_RATE_LIMIT_CODE;
  return isRateLimited
    ? { kind: "rate_limited", reason }
    : { kind: "failed", reason };
}

/** `no_pending_confirmation` junta dos casos que aquí son el mismo: la cuenta
 * ya confirmó su correo, o la dirección no tiene cuenta. En los dos no hay a
 * quién mandar nada, y el reenvío no debe distinguirlos. */
export type ConfirmationTokenIssue =
  | { readonly kind: "issued"; readonly tokenHash: string }
  | { readonly kind: "no_pending_confirmation" }
  | { readonly kind: "failed"; readonly error: SendFailure };

export type ConfirmationTokenIssuer = {
  issueConfirmationToken(email: string): Promise<ConfirmationTokenIssue>;
};

/** Sólo un fallo de entrega es un resultado. Cualquier otro error es un bug de
 * este código, y convertirlo en "no salió el correo" lo escondería. */
async function deliverConfirmationEmail(
  sender: EmailSender,
  email: string,
  confirmUrl: string,
): Promise<ConfirmationEmailOutcome> {
  try {
    await sender.sendEmail({
      to: email,
      ...renderAccountConfirmationEmail({
        confirmUrl,
        linkLifetimeMinutes: EMAIL_CONFIRMATION_LINK_LIFETIME_MINUTES,
      }),
    });
    return { kind: "requested" };
  } catch (error) {
    if (!(error instanceof EmailDeliveryError)) {
      throw error;
    }
    return toConfirmationEmailOutcome(error, email);
  }
}

export function createConfirmationEmailGateway(dependencies: {
  readonly tokens: ConfirmationTokenIssuer;
  readonly emails: EmailSenderConnection;
}): ConfirmationEmailGateway {
  const { tokens, emails } = dependencies;
  return {
    async requestConfirmationEmail(email, appUrl) {
      // Antes de emitir: un enlace nuevo invalida el anterior, y emitirlo sin
      // poder mandarlo le rompería a la persona el que ya tenía.
      if (emails.kind === "not_connected") {
        return { kind: "failed", reason: emails.reason };
      }

      const issue = await tokens.issueConfirmationToken(email);
      if (issue.kind === "no_pending_confirmation") {
        return { kind: "not_requested" };
      }
      if (issue.kind === "failed") {
        return toConfirmationEmailOutcome(issue.error, email);
      }
      return deliverConfirmationEmail(
        emails.sender,
        email,
        buildEmailConfirmationUrl(appUrl, issue.tokenHash),
      );
    },
  };
}
