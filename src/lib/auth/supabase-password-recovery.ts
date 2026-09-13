import { createHash } from "node:crypto";
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
const HTTP_NOT_FOUND = 404;

const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_MIN = 500;

type Environment = Readonly<Record<string, string | undefined>>;

function describeAuthFailure(error: AuthError): string {
  return error.code ? `${error.code}: ${error.message}` : error.message;
}

/** El hash con el que la tabla del límite reconoce un correo. Ver la
 * migración 0005 para por qué no se guarda el correo. */
export function hashRecoveryEmail(email: string): string {
  return createHash("sha256").update(email).digest("hex");
}

function createRecoveryRequestLog(
  serviceClient: SupabaseClient,
  clubId: string,
): RecoveryRequestLog {
  return {
    async recordAndCountRecent({ email, now, windowStart }) {
      const emailHash = hashRecoveryEmail(email);
      const { error: insertError } = await serviceClient
        .from(RECOVERY_REQUESTS_TABLE)
        .insert({
          club_id: clubId,
          email_hash: emailHash,
          requested_at: now.toISOString(),
        });
      if (insertError) {
        throw new Error(
          `No se pudo anotar la petición de recuperación: ${insertError.message}`,
        );
      }

      const { count, error } = await serviceClient
        .from(RECOVERY_REQUESTS_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("email_hash", emailHash)
        .gte("requested_at", windowStart.toISOString());
      if (error) {
        throw new Error(
          `No se pudieron contar las peticiones de recuperación: ${error.message}`,
        );
      }
      if (count === null) {
        throw new Error(
          "La base no devolvió el número de peticiones de recuperación.",
        );
      }
      return count;
    },
  };
}

function isUnknownIdentity(error: AuthError): boolean {
  return error.code === USER_NOT_FOUND_CODE || error.status === HTTP_NOT_FOUND;
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

/** Un enlace que no vale (caducado, ya canjeado, inventado) llega como error
 * 4xx del canje. Un 429 también es 4xx pero no dice nada del enlace: es el
 * servicio pidiendo calma, y tratarlo como enlace gastado mandaría a pedir
 * otro a quien tiene uno bueno. */
function isUnusableLink(error: AuthError): boolean {
  const status = error.status ?? HTTP_SERVER_ERROR_MIN;
  return (
    status >= HTTP_CLIENT_ERROR_MIN &&
    status < HTTP_SERVER_ERROR_MIN &&
    status !== HTTP_TOO_MANY_REQUESTS
  );
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
      const { data, error } = await client.auth.verifyOtp({
        type: RECOVERY_OTP_TYPE,
        token_hash: tokenHash,
      });
      if (error) {
        if (isUnusableLink(error)) {
          return { kind: "link_unusable", reason: describeAuthFailure(error) };
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

      const { error: updateError } = await client.auth.updateUser({
        password: newPassword,
      });
      if (updateError) {
        throw new Error(
          `El enlace se canjeó pero la contraseña no se pudo cambiar: ${describeAuthFailure(updateError)}`,
        );
      }

      // La sesión que abrió el canje sólo servía para cambiar la contraseña.
      // Nadie la recibe, así que se revoca en vez de dejarla viva en el
      // servicio hasta que caduque.
      const { error: signOutError } = await client.auth.signOut({
        scope: "local",
      });
      if (signOutError) {
        throw new Error(
          `La contraseña se cambió pero no se pudo cerrar la sesión del canje: ${describeAuthFailure(signOutError)}`,
        );
      }
      return { kind: "password_changed", userId: data.user.id };
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
  const anonConfig = readSupabaseConfig(env);
  if (authWiring.kind === "unconfigured" || anonConfig.kind === "missing") {
    return {
      kind: "unconfigured",
      missingKeys:
        authWiring.kind === "unconfigured"
          ? authWiring.missingKeys
          : anonConfig.kind === "missing"
            ? anonConfig.missingKeys
            : [],
    };
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
      requests: createRecoveryRequestLog(serviceClient, clubId),
      tokens: createRecoveryTokenIssuer(serviceClient),
      redeemer: createRecoveryTokenRedeemer(anonConfig),
      audit: createPasswordChangeAudit(serviceClient, clubId),
    },
  };
}
