import { renderPasswordRecoveryEmail } from "@/lib/email/email-templates";
import { connectResendEmailSender } from "@/lib/email/resend-email-sender";
import {
  RECOVERY_LINK_LIFETIME_MINUTES,
  type RecoveryEmailSender,
} from "./password-recovery";

/**
 * La frontera del envío del correo de recuperación (INT-006). Manda por Resend
 * con la plantilla de recuperación.
 *
 * Fuera de producción no conecta, y es deliberado: la clave de Resend sólo
 * vive en el ámbito Production de Vercel (ver `entornos.json`). Un preview o
 * una máquina de desarrollo responden entonces que no hay con qué mandar,
 * nombrando la variable, en vez de mandar correos de verdad.
 *
 * Quien la llama tiene que preguntar ANTES de mirar si la cuenta existe. Un
 * "no puedo mandar" que sólo saliera para cuentas reales delataría cuáles lo
 * son.
 */

type Environment = Readonly<Record<string, string | undefined>>;

export type RecoveryEmailSenderConnection =
  | { readonly kind: "connected"; readonly sender: RecoveryEmailSender }
  | { readonly kind: "not_connected"; readonly reason: string };

export function connectRecoveryEmailSender(
  env: Environment,
  fetchImplementation: typeof fetch = fetch,
): RecoveryEmailSenderConnection {
  const connection = connectResendEmailSender(env, fetchImplementation);
  if (connection.kind === "not_connected") {
    return connection;
  }

  const { sender } = connection;
  return {
    kind: "connected",
    sender: {
      async sendRecoveryEmail({ to, resetUrl }) {
        await sender.sendEmail({
          to,
          ...renderPasswordRecoveryEmail({
            resetUrl,
            linkLifetimeMinutes: RECOVERY_LINK_LIFETIME_MINUTES,
          }),
        });
      },
    },
  };
}
