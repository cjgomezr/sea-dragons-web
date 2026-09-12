import type { AccountStatus } from "./account-status";
import { COMPLETE_REGISTRATION_PATH, DASHBOARD_PATH } from "./routes";

/**
 * El inicio de sesión (RF-4), contado sin Supabase delante: quién es quien
 * llama, en qué estado está su cuenta y a dónde va. Los adaptadores viven en
 * `supabase-session-gateways.ts`.
 */

export type Credentials = {
  readonly email: string;
  readonly password: string;
};

/**
 * El resultado de comprobar unas credenciales. No distingue "ese correo no
 * existe" de "esa contraseña no es": esa diferencia es la que delata qué
 * correos tienen cuenta, y el ticket la prohíbe explícitamente.
 */
export type AuthenticationResult =
  | { readonly kind: "authenticated"; readonly userId: string }
  | { readonly kind: "rejected" };

export type IdentityGateway = {
  authenticate(credentials: Credentials): Promise<AuthenticationResult>;
  /** Tira la sesión que `authenticate` acaba de abrir. Hace falta porque
   * Supabase autentica antes de que nadie haya mirado si esa cuenta puede
   * operar: sin esto, una cuenta rechazada se quedaría con sesión válida. */
  discardSession(): Promise<void>;
};

export type AccountStatusGateway = {
  findAccountStatus(userId: string): Promise<AccountStatus | null>;
};

export type SignInGateways = {
  readonly identities: IdentityGateway;
  readonly accounts: AccountStatusGateway;
};

export type SignInRejectionReason =
  "invalid_credentials" | "account_unavailable";

export type SignInOutcome =
  | { readonly kind: "signed-in"; readonly destination: string }
  | {
      readonly kind: "rejected";
      readonly reason: SignInRejectionReason;
      readonly message: string;
    };

/** El mismo texto para un correo sin cuenta y para una contraseña equivocada.
 * Dos mensajes distintos convierten el formulario en un buscador de qué
 * direcciones están registradas. */
export const INVALID_CREDENTIALS_MESSAGE =
  "El correo o la contraseña no coinciden.";

/** Para la cuenta que existe pero no puede entrar: dada de baja (FR-085, que
 * llega en E5) o sin fila de miembro, que es una identidad a medio crear. No
 * dice cuál de las dos, por el mismo motivo que el mensaje de arriba. */
export const ACCOUNT_UNAVAILABLE_MESSAGE =
  "Tu cuenta no puede entrar ahora mismo. Escribe al club para que la revisen.";

function rejection(reason: SignInRejectionReason): SignInOutcome {
  return {
    kind: "rejected",
    reason,
    message:
      reason === "invalid_credentials"
        ? INVALID_CREDENTIALS_MESSAGE
        : ACCOUNT_UNAVAILABLE_MESSAGE,
  };
}

/** A dónde aterriza una cuenta que acaba de entrar. `inactive` no aparece
 * aquí: esa cuenta no llega a tener destino porque no llega a entrar. */
function destinationFor(accountStatus: "active" | "incomplete"): string {
  return accountStatus === "active"
    ? DASHBOARD_PATH
    : COMPLETE_REGISTRATION_PATH;
}

export async function signIn(
  gateways: SignInGateways,
  credentials: Credentials,
): Promise<SignInOutcome> {
  const authentication = await gateways.identities.authenticate(credentials);
  if (authentication.kind === "rejected") {
    return rejection("invalid_credentials");
  }

  const accountStatus = await gateways.accounts.findAccountStatus(
    authentication.userId,
  );
  if (accountStatus === null || accountStatus === "inactive") {
    await gateways.identities.discardSession();
    return rejection("account_unavailable");
  }

  return { kind: "signed-in", destination: destinationFor(accountStatus) };
}
