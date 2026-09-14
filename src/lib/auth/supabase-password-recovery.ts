import {
  type AuthError,
  type SupabaseClient,
  createClient,
} from "@supabase/supabase-js";
import {
  createSupabaseAuditLogWriter,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  PasswordChangeAudit,
  RecoveryRequestLog,
  RecoveryTokenIssuer,
  RecoveryTokenRedeemer,
} from "./password-recovery";
import { createSupabaseEmailRequestLog } from "./supabase-email-request-log";
import {
  DEFAULT_CLUB_SLUG,
  createSupabaseAuthGateways,
} from "./supabase-auth-gateways";

/**
 * Adaptadores entre los puertos de la recuperación de contraseña y Supabase.
 * Todo es de servidor: emitir un enlace de recuperación exige la llave de
 * servicio, que nunca llega al navegador.
 *
 * El envío del correo NO está aquí: es su propia frontera
 * (`recovery-email-sender.ts`).
 */

const RECOVERY_REQUESTS_TABLE = "password_recovery_requests";
const RECOVERY_OTP_TYPE = "recovery" as const;
const AUDITED_ENTITY_TYPE = "auth_user";

/** Supabase Auth responde este código cuando el correo no tiene identidad. Es
 * el único error de `generateLink` que significa "no hay a quién mandarlo"; el
 * resto es el servicio fallando y tiene que subir. */
const USER_NOT_FOUND_CODE = "user_not_found";
/** Los códigos con los que Supabase Auth rechaza la contraseña nueva. */
const REJECTED_PASSWORD_CODES: readonly string[] = [
  "same_password",
  "weak_password",
];

const HTTP_NOT_FOUND = 404;
const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_MIN = 500;

type Environment = Readonly<Record<string, string | undefined>>;

function describeAuthFailure(error: AuthError): string {
  return error.code ? `${error.code}: ${error.message}` : error.message;
}

/** `generateLink` dice así que el correo no tiene identidad. */
export function isUnknownIdentity(error: AuthError): boolean {
  return error.code === USER_NOT_FOUND_CODE || error.status === HTTP_NOT_FOUND;
}

/** Un enlace que no vale (caducado, ya canjeado, inventado) llega como error
 * 4xx del canje. Un 429 también es 4xx pero no dice nada del enlace: es el
 * servicio pidiendo calma, y tratarlo como enlace gastado mandaría a pedir
 * otro a quien tiene uno bueno. Sin estado HTTP no se sabe nada, así que
 * tampoco cuenta. */
export function isUnusableLink(error: AuthError): boolean {
  const status = error.status;
  return (
    status !== undefined &&
    status >= HTTP_CLIENT_ERROR_MIN &&
    status < HTTP_SERVER_ERROR_MIN &&
    status !== HTTP_TOO_MANY_REQUESTS
  );
}

export function isRejectedNewPassword(error: AuthError): boolean {
  return REJECTED_PASSWORD_CODES.includes(error.code ?? "");
}

function createRecoveryTokenIssuer(
  serviceClient: SupabaseClient,
): RecoveryTokenIssuer {
  return {
    async issueRecoveryToken(email) {
      // `generateLink` emite el token sin mandar ningún correo. El envío es
      // nuestro, y así el enlace apunta a nuestra pantalla y no a la de
      // Supabase.
      const { data, error } = await serviceClient.auth.admin.generateLink({
        type: RECOVERY_OTP_TYPE,
        email,
      });
      if (error) {
        if (isUnknownIdentity(error)) {
          return { kind: "no_account" };
        }
        throw new Error(
          `Supabase Auth no pudo emitir el enlace de recuperación: ${describeAuthFailure(error)}`,
        );
      }
      return { kind: "issued", tokenHash: data.properties.hashed_token };
    },
  };
}

type TokenVerification =
  | { readonly kind: "verified"; readonly userId: string }
  | { readonly kind: "link_unusable" };

/** Canjea el token. Esto es lo que gasta el enlace, y deja abierta en `client`
 * la sesión con la que se cambia la contraseña. */
async function verifyRecoveryToken(
  client: SupabaseClient,
  tokenHash: string,
): Promise<TokenVerification> {
  const { data, error } = await client.auth.verifyOtp({
    type: RECOVERY_OTP_TYPE,
    token_hash: tokenHash,
  });
  if (error) {
    if (isUnusableLink(error)) {
      return { kind: "link_unusable" };
    }
    throw new Error(
      `Supabase Auth no pudo canjear el enlace de recuperación: ${describeAuthFailure(error)}`,
    );
  }
  if (!data.user || !data.session) {
    throw new Error(
      "Supabase Auth canjeó el enlace de recuperación sin devolver usuario ni sesión.",
    );
  }
  return { kind: "verified", userId: data.user.id };
}

async function setNewPassword(
  client: SupabaseClient,
  newPassword: string,
): Promise<"changed" | "rejected"> {
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (!error) {
    return "changed";
  }
  if (isRejectedNewPassword(error)) {
    return "rejected";
  }
  throw new Error(
    `El enlace se canjeó pero la contraseña no se pudo cambiar: ${describeAuthFailure(error)}`,
  );
}

/** La sesión del canje sólo servía para cambiar la contraseña y nadie la
 * recibe, así que se revoca. Si la revocación falla se registra con su motivo
 * y NO se lanza: para entonces el cambio ya ocurrió, y convertirlo en un error
 * le diría a la persona que su contraseña no cambió, además de saltarse la
 * entrada de la bitácora que el dominio escribe después. */
async function closeRedemptionSession(client: SupabaseClient): Promise<void> {
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) {
    console.error(
      "[auth/password-recovery] no se pudo revocar la sesión del canje",
      describeAuthFailure(error),
    );
  }
}

function createRecoveryTokenRedeemer(anon: {
  readonly url: string;
  readonly anonKey: string;
}): RecoveryTokenRedeemer {
  return {
    async redeemRecoveryToken({ tokenHash, newPassword }) {
      // Un cliente por canje: el canje abre una sesión en el cliente, y
      // compartirlo mezclaría la sesión de una persona con la de otra.
      const client = createClient(anon.url, anon.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const verification = await verifyRecoveryToken(client, tokenHash);
      if (verification.kind === "link_unusable") {
        return verification;
      }

      // `finally` porque la sesión del canje se revoca también cuando el cambio
      // lanza (un 500 del servicio, la red): nadie la recibe, pero no tiene por
      // qué seguir viva hasta que caduque.
      let change: "changed" | "rejected";
      try {
        change = await setNewPassword(client, newPassword);
      } finally {
        await closeRedemptionSession(client);
      }
      return change === "changed"
        ? { kind: "password_changed", userId: verification.userId }
        : { kind: "password_rejected" };
    },
  };
}

function createPasswordChangeAudit(
  serviceClient: SupabaseClient,
  clubId: string,
): PasswordChangeAudit {
  const writer = createSupabaseAuditLogWriter(serviceClient);
  return {
    async recordPasswordChanged(userId) {
      await recordAuditEvent(writer, {
        actor: { id: userId, clubId },
        clubId,
        action: "auth.password_changed",
        entityType: AUDITED_ENTITY_TYPE,
        entityId: userId,
        result: "success",
      });
    },
  };
}

export type PasswordRecoveryGateways = {
  readonly requests: RecoveryRequestLog;
  readonly tokens: RecoveryTokenIssuer;
  readonly redeemer: RecoveryTokenRedeemer;
  readonly audit: PasswordChangeAudit;
};

export type PasswordRecoveryGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: PasswordRecoveryGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición. Pide el mismo entorno que el resto de rutas de
 * cuentas, y lo comprueba con la misma pieza para que las faltas se nombren
 * igual en todas. */
export async function createSupabasePasswordRecoveryGateways(
  env: Environment,
): Promise<PasswordRecoveryGatewaysResult> {
  const authWiring = createSupabaseAuthGateways(env);
  if (authWiring.kind === "unconfigured") {
    return authWiring;
  }
  const anonConfig = readSupabaseConfig(env);
  if (anonConfig.kind === "missing") {
    return { kind: "unconfigured", missingKeys: anonConfig.missingKeys };
  }

  // Release 1 opera un solo club (ver DEFAULT_CLUB_SLUG). La identidad que
  // recupera la contraseña puede no tener fila de socio, así que el club no se
  // saca de ella.
  const clubId =
    await authWiring.gateways.clubs.findClubIdBySlug(DEFAULT_CLUB_SLUG);
  const serviceClient = createServiceRoleClient(env);

  return {
    kind: "ready",
    gateways: {
      requests: createSupabaseEmailRequestLog(serviceClient, {
        table: RECOVERY_REQUESTS_TABLE,
        clubId,
      }),
      tokens: createRecoveryTokenIssuer(serviceClient),
      redeemer: createRecoveryTokenRedeemer(anonConfig),
      audit: createPasswordChangeAudit(serviceClient, clubId),
    },
  };
}
