import {
  type IdentityConfirmationReader,
  type MemberAccountStore,
  activateAccountIfComplete,
} from "./account-activation";

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
    readonly now: Date;
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
    {
      now: input.now,
    },
  );
  return activation.kind === "activated"
    ? { kind: "activated" }
    : { kind: "confirmed_still_incomplete" };
}
