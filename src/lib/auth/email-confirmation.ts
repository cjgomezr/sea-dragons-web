import {
  type IdentityConfirmationReader,
  type MemberAccountStore,
  activateAccountIfComplete,
} from "./account-activation";
import { EMAIL_CONFIRMATION_PATH } from "./routes";

/** Los parámetros con los que el enlace del correo lleva el token hasta
 * `EMAIL_CONFIRMATION_PATH`. Los usan quien arma el enlace y quien lo canjea,
 * para que no se desincronicen. */
export const EMAIL_CONFIRMATION_TOKEN_HASH_PARAM = "token_hash";
export const EMAIL_CONFIRMATION_TYPE_PARAM = "type";

/** Lo impone Supabase Auth (`mailer_otp_exp` del proyecto, 3600 segundos, el
 * mismo ajuste que fija la vigencia del enlace de recuperación): aquí sólo se
 * nombra para que el correo le diga a la persona cuánto tiene. */
export const EMAIL_CONFIRMATION_LINK_LIFETIME_MINUTES = 60;

const SIGNUP_OTP_TYPE = "signup";

/** El enlace del correo de confirmación. Apunta al origen de `appUrl`, que es
 * la petición que lo pidió: así un preview no manda a confirmar a producción. */
export function buildEmailConfirmationUrl(
  appUrl: string,
  tokenHash: string,
): string {
  const url = new URL(EMAIL_CONFIRMATION_PATH, appUrl);
  url.searchParams.set(EMAIL_CONFIRMATION_TOKEN_HASH_PARAM, tokenHash);
  url.searchParams.set(EMAIL_CONFIRMATION_TYPE_PARAM, SIGNUP_OTP_TYPE);
  return url.toString();
}

/** Los tipos de enlace que confirman una dirección de correo en Supabase. El
 * enlace del registro llega como signup; las plantillas que confirman un
 * cambio de dirección usan email. Cualquier otro tipo (recovery, invite) hace
 * otra cosa y no se canjea aquí. */
export const EMAIL_CONFIRMATION_OTP_TYPES = ["signup", "email"] as const;

export type EmailConfirmationOtpType =
  (typeof EMAIL_CONFIRMATION_OTP_TYPES)[number];

/** Estrecha el parámetro que llega en la URL del correo. Devuelve null en vez
 * de lanzar porque un tipo desconocido es un enlace que no vale, no un fallo
 * del servidor. */
export function parseEmailConfirmationOtpType(
  value: string | null,
): EmailConfirmationOtpType | null {
  return (
    EMAIL_CONFIRMATION_OTP_TYPES.find((candidate) => candidate === value) ??
    null
  );
}

export type EmailConfirmation =
  | { readonly kind: "confirmed"; readonly userId: string }
  | { readonly kind: "rejected"; readonly reason: string };

export type EmailConfirmationGateway = {
  confirmEmail(input: {
    readonly tokenHash: string;
    readonly type: EmailConfirmationOtpType;
  }): Promise<EmailConfirmation>;
};

export type EmailConfirmationResult =
  | { readonly kind: "activated" }
  | { readonly kind: "confirmed_still_incomplete" }
  | { readonly kind: "rejected"; readonly reason: string };

/** Canjea el enlace del correo y recalcula el estado de la cuenta. Confirmar
 * no activa por sí solo: activa sólo si la confirmación era lo único que
 * faltaba (FR-083). */
export async function confirmEmailAndActivate(
  gateways: {
    readonly confirmations: EmailConfirmationGateway;
    readonly accounts: MemberAccountStore;
    readonly identities: IdentityConfirmationReader;
  },
  input: {
    readonly tokenHash: string;
    readonly type: EmailConfirmationOtpType;
  },
): Promise<EmailConfirmationResult> {
  const confirmation = await gateways.confirmations.confirmEmail({
    tokenHash: input.tokenHash,
    type: input.type,
  });
  if (confirmation.kind === "rejected") {
    return { kind: "rejected", reason: confirmation.reason };
  }

  const activation = await activateAccountIfComplete(
    gateways,
    confirmation.userId,
  );
  return activation.kind === "activated"
    ? { kind: "activated" }
    : { kind: "confirmed_still_incomplete" };
}
