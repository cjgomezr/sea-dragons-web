import type { EmailRequestLog } from "./email-request-log";
import type {
  ConfirmationEmailGateway,
  ConfirmationEmailOutcome,
} from "./register-member";

/**
 * El reenvío público del correo de confirmación, con su límite por correo.
 *
 * Hasta el #137 el tope lo ponía sin querer el servicio incorporado de
 * Supabase, a 2 correos por hora. Con Resend no hay tope ajeno: sin este, un
 * bucle contra el endpoint llenaría un buzón que no es suyo, invalidaría una y
 * otra vez el enlace bueno de la persona y agotaría el cupo diario, que es el
 * mismo con el que sale la recuperación de contraseña.
 *
 * El límite se aplica antes de mirar la cuenta, y se aplica igual exista o
 * no: un límite que sólo contara cuentas reales las delataría por la forma de
 * responder.
 *
 * El correo no se pide aquí: queda en `deliver`, para que la ruta responda
 * antes. Sólo hay envío para una cuenta sin confirmar, y si la respuesta lo
 * esperara, lo que tarda delataría cuáles lo son.
 */

/** La misma ventana y el mismo tope que la recuperación: tres correos en un
 * cuarto de hora cubren a quien no encuentra el primero en su buzón. */
export const CONFIRMATION_EMAIL_WINDOW_MINUTES = 15;
export const MAX_CONFIRMATION_EMAILS_PER_WINDOW = 3;

const MILLISECONDS_PER_MINUTE = 60_000;

export type ConfirmationEmailResendOutcome =
  | {
      readonly kind: "accepted";
      /** Pide el correo y dice qué pasó. Va aparte porque sólo hay envío para
       * una cuenta sin confirmar: quien responde no debe esperarlo. */
      readonly deliver: () => Promise<ConfirmationEmailOutcome>;
    }
  | { readonly kind: "rate_limited"; readonly retryAfterMinutes: number };

export async function resendConfirmationEmail(
  gateways: {
    readonly requests: EmailRequestLog;
    readonly confirmationEmail: ConfirmationEmailGateway;
  },
  input: {
    readonly email: string;
    readonly now: Date;
    readonly appUrl: string;
  },
): Promise<ConfirmationEmailResendOutcome> {
  const requestsInWindow = await gateways.requests.recordAndCountRecent({
    email: input.email,
    now: input.now,
    windowStart: new Date(
      input.now.getTime() -
        CONFIRMATION_EMAIL_WINDOW_MINUTES * MILLISECONDS_PER_MINUTE,
    ),
  });
  if (requestsInWindow > MAX_CONFIRMATION_EMAILS_PER_WINDOW) {
    return {
      kind: "rate_limited",
      retryAfterMinutes: CONFIRMATION_EMAIL_WINDOW_MINUTES,
    };
  }

  return {
    kind: "accepted",
    deliver: () =>
      gateways.confirmationEmail.requestConfirmationEmail(
        input.email,
        input.appUrl,
      ),
  };
}
