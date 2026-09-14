import type { RecoveryEmailSender } from "./password-recovery";

/**
 * La frontera del envío del correo de recuperación (INT-006).
 *
 * Hoy no hay proveedor conectado, y eso es deliberado: el ticket de Resend
 * (el 7 del PRD de E2) necesita un dominio verificado y una credencial que
 * crea una persona. Hasta entonces el flujo entero se prueba contra un doble
 * y esta función dice la verdad: no hay con qué mandar.
 *
 * Quien la llama tiene que preguntar ANTES de mirar si la cuenta existe. Un
 * "no puedo mandar" que sólo saliera para cuentas reales delataría cuáles lo
 * son.
 */

export type RecoveryEmailSenderConnection =
  | { readonly kind: "connected"; readonly sender: RecoveryEmailSender }
  | { readonly kind: "not_connected"; readonly reason: string };

export const RECOVERY_EMAIL_NOT_CONNECTED_REASON =
  "El envío de correos todavía no está conectado, así que la recuperación de contraseña no puede mandar enlaces. Escribe al club para recuperar el acceso.";

export function connectRecoveryEmailSender(): RecoveryEmailSenderConnection {
  return { kind: "not_connected", reason: RECOVERY_EMAIL_NOT_CONNECTED_REASON };
}
