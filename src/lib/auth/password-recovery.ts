import { validatePasswordField } from "./registration";

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

export type RecoveryRequestLog = {
  /** Anota la petición y devuelve cuántas hubo desde `windowStart`, contando
   * esta. Anotar antes de contar es lo que impide que una ráfaga en paralelo
   * lea todas el mismo contador por debajo del tope. */
  recordAndCountRecent(input: {
    readonly email: string;
    readonly now: Date;
    readonly windowStart: Date;
  }): Promise<number>;
};

export type RecoveryTokenIssue =
  | { readonly kind: "issued"; readonly tokenHash: string }
  | { readonly kind: "no_account" };

export type RecoveryTokenIssuer = {
  issueRecoveryToken(email: string): Promise<RecoveryTokenIssue>;
};

export type RecoveryEmail = {
  readonly to: string;
  readonly resetUrl: string;
};

/** Lanza si el correo no sale. No devuelve el fallo como un resultado porque,
 * a diferencia de la confirmación del registro, aquí el correo ES la
 * funcionalidad: decir "te lo mandamos" sin haberlo mandado deja a alguien
 * esperando un enlace que nunca llega. */
export type RecoveryEmailSender = {
  sendRecoveryEmail(email: RecoveryEmail): Promise<void>;
};

export type PasswordRecoveryRequestGateways = {
  readonly requests: RecoveryRequestLog;
  readonly tokens: RecoveryTokenIssuer;
  readonly emails: RecoveryEmailSender;
};

/** No distingue si la cuenta existe: esa diferencia convertiría el formulario
 * en un buscador de quién es socio del club. */
export type PasswordRecoveryRequestOutcome =
  | { readonly kind: "requested" }
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
 * volvería a delatarlas por la forma de responder. */
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

  const issue = await gateways.tokens.issueRecoveryToken(input.email);
  if (issue.kind === "issued") {
    await deliverRecoveryEmail(gateways.emails, {
      to: input.email,
      resetUrl: input.buildResetUrl(issue.tokenHash),
    });
  }
  return { kind: "requested" };
}

/** Un enlace caducado y uno ya usado son el mismo caso para quien lo abre: no
 * sirve y hay que pedir otro. El motivo técnico se queda en el servidor. */
export type RecoveryTokenRedemption =
  | { readonly kind: "password_changed"; readonly userId: string }
  | { readonly kind: "link_unusable"; readonly reason: string };

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

export type PasswordResetOutcome =
  | { readonly kind: "password_changed" }
  | { readonly kind: "link_unusable" }
  | { readonly kind: "invalid_password"; readonly message: string };

/** Fija la contraseña nueva. La contraseña se valida antes de canjear el
 * token: una demasiado corta no puede gastar el enlace. */
export async function resetPassword(
  gateways: PasswordResetGateways,
  input: { readonly tokenHash: string; readonly password: string },
): Promise<PasswordResetOutcome> {
  const password = validatePasswordField(input.password);
  if (!password.ok) {
    return { kind: "invalid_password", message: password.message };
  }

  const redemption = await gateways.tokens.redeemRecoveryToken({
    tokenHash: input.tokenHash,
    newPassword: password.value,
  });
  if (redemption.kind === "link_unusable") {
    return { kind: "link_unusable" };
  }

  await gateways.audit.recordPasswordChanged(redemption.userId);
  return { kind: "password_changed" };
}
