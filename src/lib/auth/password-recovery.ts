import {
  type EmailLocaleDirectory,
  readEmailLocale,
} from "@/lib/email/email-locale";
import type { Locale } from "@/lib/i18n/locale";
import type { EmailRequestLog } from "./email-request-log";
import { type FieldIssueCode, validatePasswordField } from "./registration";
import { PASSWORD_RESET_PATH, RESET_TOKEN_QUERY_PARAM } from "./routes";

/**
 * La recuperación de contraseña (RF-6), contada sin Supabase ni proveedor de
 * correo delante. Los adaptadores viven en `supabase-password-recovery.ts`; el
 * envío del correo es una frontera propia para que el ticket de Resend la
 * sustituya sin tocar nada de aquí.
 */

/** La ventana y el tope del límite por correo. Tres enlaces en un cuarto de
 * hora cubren a quien no encuentra el primero en su buzón, y dejan el
 * formulario inservible como ametralladora contra el buzón de otra persona. */
export const PASSWORD_RECOVERY_WINDOW_MINUTES = 15;
export const MAX_RECOVERY_REQUESTS_PER_WINDOW = 3;

const MILLISECONDS_PER_MINUTE = 60_000;

/** NFR-007. No lo impone este código sino Supabase Auth (`mailer_otp_exp` del
 * proyecto, 3600 segundos, comprobado el 14 de septiembre de 2026): aquí sólo
 * se nombra para que las pantallas le digan a la persona cuánto tiene. */
export const RECOVERY_LINK_LIFETIME_MINUTES = 60;

export type RecoveryRequestLog = EmailRequestLog;

/** El enlace de elegir contraseña nueva. Apunta al origen de `appUrl`, que es
 * la petición que lo pidió: en Vercel sólo llegan a un despliegue las
 * peticiones dirigidas a sus propios dominios, así que un `Host` inventado no
 * alcanza este código para envenenar el enlace. Lo usan la recuperación y la
 * invitación de un miembro dado de alta por un Admin (#243). */
export function buildPasswordResetUrl(
  appUrl: string,
  tokenHash: string,
): string {
  const url = new URL(PASSWORD_RESET_PATH, appUrl);
  url.searchParams.set(RESET_TOKEN_QUERY_PARAM, tokenHash);
  return url.toString();
}

export type RecoveryTokenIssue =
  | {
      readonly kind: "issued";
      readonly tokenHash: string;
      /** La identidad dueña del enlace: de su fila sale el idioma. */
      readonly userId: string;
    }
  | { readonly kind: "no_account" };

export type RecoveryTokenIssuer = {
  issueRecoveryToken(email: string): Promise<RecoveryTokenIssue>;
};

export type RecoveryEmail = {
  readonly to: string;
  readonly resetUrl: string;
  readonly locale: Locale;
};

/** Lanza si el correo no sale, para que el fallo llegue con su causa a quien
 * lo registra. La respuesta a quien pidió el enlace no puede reflejarlo: el
 * envío sólo existe para cuentas reales, y un error visible sólo para ellas
 * las delataría (#147). Por eso la ruta responde antes de mandar y deja el
 * fallo en el registro del servidor. */
export type RecoveryEmailSender = {
  sendRecoveryEmail(email: RecoveryEmail): Promise<void>;
};

export type PasswordRecoveryRequestGateways = {
  readonly requests: RecoveryRequestLog;
  readonly tokens: RecoveryTokenIssuer;
  readonly emails: RecoveryEmailSender;
  readonly emailLocales: EmailLocaleDirectory;
};

/** No distingue si la cuenta existe: esa diferencia convertiría el formulario
 * en un buscador de quién es socio del club. */
export type PasswordRecoveryRequestOutcome =
  | {
      readonly kind: "accepted";
      /** Emite el enlace y lo manda, si la cuenta existe. Va aparte porque
       * depende de la cuenta: quien responde no debe esperarlo. */
      readonly deliver: () => Promise<void>;
    }
  | { readonly kind: "rate_limited"; readonly retryAfterMinutes: number };

export class RecoveryEmailDeliveryError extends Error {
  constructor(cause: unknown) {
    super(
      `No se pudo mandar el correo de recuperación de contraseña: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = "RecoveryEmailDeliveryError";
    this.cause = cause;
  }
}

async function deliverRecoveryEmail(
  sender: RecoveryEmailSender,
  email: RecoveryEmail,
): Promise<void> {
  try {
    await sender.sendRecoveryEmail(email);
  } catch (error) {
    throw new RecoveryEmailDeliveryError(error);
  }
}

/** Pide el enlace. El límite se aplica antes de mirar si la cuenta existe, y
 * se aplica igual a las dos: un límite que sólo contara cuentas reales
 * volvería a delatarlas por la forma de responder.
 *
 * Emitir el enlace y mandar el correo quedan en `deliver`, sin ejecutar: sólo
 * ocurren si la cuenta existe, y si la respuesta los esperara, lo que tarda
 * la delataría igual. Quien llama responde primero y entrega después. */
export async function requestPasswordRecovery(
  gateways: PasswordRecoveryRequestGateways,
  input: {
    readonly email: string;
    readonly now: Date;
    readonly buildResetUrl: (tokenHash: string) => string;
  },
): Promise<PasswordRecoveryRequestOutcome> {
  const requestsInWindow = await gateways.requests.recordAndCountRecent({
    email: input.email,
    now: input.now,
    windowStart: new Date(
      input.now.getTime() -
        PASSWORD_RECOVERY_WINDOW_MINUTES * MILLISECONDS_PER_MINUTE,
    ),
  });
  if (requestsInWindow > MAX_RECOVERY_REQUESTS_PER_WINDOW) {
    return {
      kind: "rate_limited",
      retryAfterMinutes: PASSWORD_RECOVERY_WINDOW_MINUTES,
    };
  }

  return {
    kind: "accepted",
    deliver: async () => {
      const issue = await gateways.tokens.issueRecoveryToken(input.email);
      if (issue.kind === "issued") {
        // El idioma también es de la cuenta: se lee aquí, después de
        // responder, igual que el resto de lo que depende de ella.
        await deliverRecoveryEmail(gateways.emails, {
          to: input.email,
          resetUrl: input.buildResetUrl(issue.tokenHash),
          locale: await readEmailLocale(gateways.emailLocales, issue.userId),
        });
      }
    },
  };
}

/**
 * Lo que pasa al canjear el enlace con una contraseña nueva.
 *
 * - `link_unusable`: caducado o ya usado. Para quien lo abre son el mismo
 *   caso, y los dos se arreglan pidiendo otro.
 * - `password_rejected`: el enlace se canjeó (y con eso se gastó) pero Supabase
 *   Auth no aceptó la contraseña: igual a la anterior, o más débil que la
 *   política del proyecto. Existe aparte para no disfrazarlo de fallo del
 *   servidor.
 */
export type RecoveryTokenRedemption =
  | { readonly kind: "password_changed"; readonly userId: string }
  | { readonly kind: PasswordResetGoneReason };

/** Canjea el token y fija la contraseña nueva en un solo paso. Van juntos
 * porque el canje es lo que gasta el enlace: separarlos dejaría un enlace
 * gastado y la contraseña sin cambiar si lo segundo falla. */
export type RecoveryTokenRedeemer = {
  redeemRecoveryToken(input: {
    readonly tokenHash: string;
    readonly newPassword: string;
  }): Promise<RecoveryTokenRedemption>;
};

/** Recibe sólo la identidad a propósito: la contraseña y el enlace no pueden
 * acabar en la bitácora si esta frontera no llega a verlos. */
export type PasswordChangeAudit = {
  recordPasswordChanged(userId: string): Promise<void>;
};

export type PasswordResetGateways = {
  readonly tokens: RecoveryTokenRedeemer;
  readonly audit: PasswordChangeAudit;
};

/** Los dos desenlaces que gastan el enlace sin cambiar la contraseña. La API
 * los responde con el mismo 410 y los nombra en su motivo, para que quien la
 * llama pueda explicarlos distinto. */
export type PasswordResetGoneReason = "link_unusable" | "password_rejected";

export type PasswordResetOutcome =
  | { readonly kind: "password_changed" }
  | { readonly kind: PasswordResetGoneReason }
  | { readonly kind: "invalid_password"; readonly code: FieldIssueCode };

/** Fija la contraseña nueva. La contraseña se valida antes de canjear el
 * token: una demasiado corta no puede gastar el enlace. */
export async function resetPassword(
  gateways: PasswordResetGateways,
  input: { readonly tokenHash: string; readonly password: string },
): Promise<PasswordResetOutcome> {
  const password = validatePasswordField(input.password);
  if (!password.ok) {
    return { kind: "invalid_password", code: password.code };
  }

  const redemption = await gateways.tokens.redeemRecoveryToken({
    tokenHash: input.tokenHash,
    newPassword: password.value,
  });
  if (redemption.kind !== "password_changed") {
    return redemption;
  }

  await gateways.audit.recordPasswordChanged(redemption.userId);
  return { kind: "password_changed" };
}
