import type { NextResponse } from "next/server";
import {
  isAuthSessionMissingError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  type IncomingCookie,
  applySessionCookies,
  createSessionClient,
  expireSessionCookies,
} from "@/lib/supabase/session-client";
import { parseAccountStatus } from "./account-status";
import type {
  AccountStatusGateway,
  IdentityGateway,
  SignInGateways,
} from "./sign-in";

/**
 * Adaptadores entre los puertos del inicio de sesión y Supabase Auth, sobre el
 * cliente que lleva la sesión en cookies.
 *
 * Ninguna función de aquí toca la llave de servicio: el inicio de sesión no
 * necesita saltarse RLS, y la fila de miembro que consulta es la propia, que
 * es justo lo que la policy `members_select_own` deja leer.
 */

const MEMBERS_TABLE = "members";
const ACCOUNT_STATUS_COLUMN = "account_status";

/** Los códigos con los que Supabase Auth dice "esas credenciales no valen".
 * Cualquier otro error es un problema del servicio, y confundirlos sería
 * decirle "revisa tu contraseña" a quien tiene la contraseña bien. */
const INVALID_CREDENTIALS_CODES: readonly string[] = [
  "invalid_credentials",
  "invalid_grant",
];

/** Supabase devuelve esto cuando la contraseña es correcta pero el correo
 * sigue sin confirmar. La cuenta existe y está `incomplete` (FR-083), pero no
 * hay sesión que dar hasta que se abra el enlace. */
const EMAIL_NOT_CONFIRMED_CODE = "email_not_confirmed";

/**
 * Cerrar sesión termina ESTA sesión, no todas las de la persona.
 *
 * El valor por defecto de Supabase es `global`, que revoca también las demás:
 * salir en el portátil dejaría fuera al teléfono, que es un efecto que nadie
 * pidió y que sorprende. Los dos criterios del ticket se cumplen igual con
 * `local`: dos pestañas del mismo navegador comparten sesión, así que cerrarla
 * en una la cierra para las dos, y la credencial de esa sesión deja de valer
 * porque es esa la que se revoca.
 */
const SIGN_OUT_SCOPE = "local" as const;

export type SessionGatewaysResult =
  | {
      readonly kind: "ready";
      readonly gateways: SignInGateways;
      readonly signOut: () => Promise<void>;
      readonly applyCookies: (response: NextResponse) => void;
      /** Para el camino en el que la sesión recién abierta no puede entregarse.
       * Ver `expireSessionCookies`. */
      readonly expireCookies: (response: NextResponse) => void;
    }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

type Environment = Readonly<Record<string, string | undefined>>;

function describeAuthFailure(error: {
  readonly code?: string;
  readonly message: string;
}): string {
  return error.code ? `${error.code}: ${error.message}` : error.message;
}

function createIdentityGateway(client: SupabaseClient): IdentityGateway {
  return {
    async authenticate({ email, password }) {
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        if (
          INVALID_CREDENTIALS_CODES.includes(error.code ?? "") ||
          error.code === EMAIL_NOT_CONFIRMED_CODE
        ) {
          return { kind: "rejected" };
        }
        throw new Error(
          `Supabase Auth no pudo comprobar las credenciales: ${describeAuthFailure(error)}`,
        );
      }
      if (!data.user) {
        throw new Error(
          "Supabase Auth aceptó las credenciales pero no devolvió el usuario.",
        );
      }
      return { kind: "authenticated", userId: data.user.id };
    },

    async discardSession() {
      const { error } = await client.auth.signOut({ scope: SIGN_OUT_SCOPE });
      if (error) {
        throw new Error(
          `No se pudo cerrar la sesión recién abierta: ${describeAuthFailure(error)}`,
        );
      }
    },
  };
}

/** Exportado porque lo usan dos sitios: el inicio de sesión, que decide a
 * dónde manda a quien entra, y la frontera de sesión, que decide qué alcanza
 * en cada petición. Una segunda copia de esta consulta sería una segunda
 * definición de qué cuenta como cuenta que puede operar. */
export function createAccountStatusGateway(
  client: SupabaseClient,
): AccountStatusGateway {
  return {
    async findAccountStatus(userId) {
      const { data, error } = await client
        .from(MEMBERS_TABLE)
        .select(ACCOUNT_STATUS_COLUMN)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        throw new Error(
          `No se pudo leer el estado de la cuenta: ${error.message}`,
        );
      }
      return data === null
        ? null
        : parseAccountStatus(data[ACCOUNT_STATUS_COLUMN]);
    },
  };
}

export function createSupabaseSessionGateways(
  env: Environment,
  incomingCookies: readonly IncomingCookie[],
): SessionGatewaysResult {
  const session = createSessionClient(env, incomingCookies);
  if (session.kind === "unconfigured") {
    return { kind: "unconfigured", missingKeys: session.missingKeys };
  }

  const identities = createIdentityGateway(session.client);
  return {
    kind: "ready",
    gateways: {
      identities,
      accounts: createAccountStatusGateway(session.client),
    },
    // Cerrar una sesión que ya no existe no es un fallo: la respuesta es la
    // misma, no hay sesión. Es lo que pasa cuando se cierra en dos pestañas.
    signOut: async () => {
      const { error } = await session.client.auth.signOut({
        scope: SIGN_OUT_SCOPE,
      });
      if (error && !isAuthSessionMissingError(error)) {
        throw new Error(
          `No se pudo cerrar la sesión: ${describeAuthFailure(error)}`,
        );
      }
    },
    applyCookies: (response) => applySessionCookies(response, session.recorder),
    expireCookies: (response) =>
      expireSessionCookies(response, session.recorder),
  };
}
