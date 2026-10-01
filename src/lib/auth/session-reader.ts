import { isAuthSessionMissingError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionState } from "./session-boundary";
import { isStandingCurrent } from "@/lib/membership/membership";
import { type SessionCache, sharedSessionCache } from "./session-cache";
import {
  type MemberAccess,
  findMemberAccess,
} from "./supabase-session-gateways";

/**
 * Quién está pidiendo algo, en los términos que la frontera entiende.
 *
 * Son dos preguntas y las dos viajan a Supabase. La primera usa `getUser()`,
 * que pregunta al servidor de autenticación en vez de verificar el token en
 * local: una sesión recién cerrada deja un token que todavía no ha caducado, y
 * verificarlo en local lo daría por bueno. La segunda lee la fila de miembro,
 * porque una cuenta `incomplete` tiene sesión válida y aun así no puede operar
 * (FR-083), y trae en la misma consulta el rol y la membresía que deciden qué
 * alcanza (#453). Los dos se leen de la base y no del token, para que un
 * cambio no espere a que el token caduque ni obligue a cerrar sesión.
 *
 * Hasta el 30 de septiembre de 2026 las dos se hacían en cada petición. Ese
 * día el dueño aceptó hasta 30 segundos de retraso en que un cierre de sesión
 * ajeno, una baja, un cambio de rol o de membresía surtan efecto (#434): la respuesta se
 * guarda en `session-cache.ts` bajo el token de acceso. Quien cierra su propia
 * sesión sale al instante, porque su navegador ya no manda la cookie; y quien
 * cambia un rol o un estado olvida lo guardado de ese socio en ese momento.
 */

const ANONYMOUS: SessionState = { kind: "anonymous" };

/** Quién pide, según su cookie de sesión. */
export type AuthenticatedCaller = {
  readonly userId: string;
  readonly email: string;
};

/**
 * La identidad de quien pide, o `null` si no hay ninguna sesión que valga.
 *
 * Una identidad sin correo también cuenta como ninguna. Toda cuenta de este
 * proyecto nace de un registro con correo (FR-001), así que si Supabase
 * devolviera una sin él no sería alguien a quien esta aplicación pueda servir,
 * y se niega el paso en vez de inventarle una dirección vacía.
 */
export async function readAuthenticatedCaller(
  client: SupabaseClient,
): Promise<AuthenticatedCaller | null> {
  const { data, error } = await client.auth.getUser();
  if (error) {
    // Sin cookie de sesión no hay nada que validar ni viaje que hacer: es el
    // caso normal de una visita anónima, no un fallo que contar.
    if (!isAuthSessionMissingError(error)) {
      // Un token inválido y un Supabase inalcanzable llegan los dos aquí. Los
      // dos se resuelven igual, negando el paso, pero uno de los dos es una
      // avería y tiene que dejar rastro.
      console.error("[sesión] no se pudo validar la sesión:", error.message);
    }
    return null;
  }
  const user = data.user;
  return user?.email ? { userId: user.id, email: user.email } : null;
}

/** Sólo el id, que es lo único que necesitan la frontera y los endpoints que
 * actúan sobre la cuenta de quien llama. */
export async function readAuthenticatedUserId(
  client: SupabaseClient,
): Promise<string | null> {
  return (await readAuthenticatedCaller(client))?.userId ?? null;
}

/** `inactive` (una baja de socio) y la identidad sin fila de miembro no abren
 * ninguna puerta, así que son lo mismo que no tener sesión. Un rol que el
 * catálogo no reconoce tampoco, sea cual sea el estado de la cuenta: una fila
 * así está corrupta (el `check` de `members.role` no la deja existir), y
 * adivinar qué permisos quiso darle la base es justo como un valor raro acaba
 * abriendo algo. */
function toSessionState(
  userId: string,
  access: MemberAccess | null,
  now: Date,
): SessionState {
  if (access === null) {
    return ANONYMOUS;
  }
  if (access.role === null) {
    console.error(
      `[sesión] la fila de miembro de ${userId} tiene un rol que el catálogo no reconoce`,
    );
    return ANONYMOUS;
  }
  switch (access.accountStatus) {
    case "active":
      return {
        kind: "active",
        role: access.role,
        membershipCurrent: isStandingCurrent(access.membership, now),
      };
    case "incomplete":
      return { kind: "incomplete" };
    default:
      return ANONYMOUS;
  }
}

/**
 * El token de acceso que trae la cookie, o `null` si no llegó ninguna sesión.
 * `getSession()` no viaja con un token vivo; con uno caducado lo refresca, y
 * las cookies nuevas quedan grabadas para la respuesta como antes.
 */
async function readAccessToken(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.auth.getSession();
  if (error) {
    // Un refresco que no se pudo hacer: se niega el paso y queda rastro, como
    // con cualquier otra avería de la sesión.
    console.error("[sesión] no se pudo leer la sesión:", error.message);
    return null;
  }
  return data.session?.access_token ?? null;
}

async function askSupabaseForSessionState(
  client: SupabaseClient,
  userId: string,
): Promise<SessionState> {
  try {
    const access = await findMemberAccess(client, userId);
    return toSessionState(userId, access, new Date());
  } catch (error) {
    // Una frontera que se cae hacia el lado abierto cuando la base no contesta
    // no es una frontera. Se niega el paso y se deja escrito por qué.
    console.error(
      "[sesión] no se pudo leer el estado de la cuenta:",
      error instanceof Error ? error.message : String(error),
    );
    return ANONYMOUS;
  }
}

export async function readSessionState(
  client: SupabaseClient,
  cache: SessionCache = sharedSessionCache,
): Promise<SessionState> {
  const accessToken = await readAccessToken(client);
  if (accessToken === null) {
    return ANONYMOUS;
  }
  const remembered = cache.read(accessToken);
  if (remembered !== null) {
    return remembered;
  }

  const userId = await readAuthenticatedUserId(client);
  if (userId === null) {
    return ANONYMOUS;
  }
  const state = await askSupabaseForSessionState(client, userId);
  if (state.kind !== "anonymous") {
    cache.remember({ accessToken, userId, state });
  }
  return state;
}

/**
 * El id de quien tiene la sesión, para lo que no decide ningún permiso: la
 * cáscara lo pasa a la búsqueda global para reconocer al propio socio (#427).
 * Tras `readSessionState` lo tiene la memoria, así que no cuesta otro viaje
 * a Supabase por pantalla (#434); sin ella, se pregunta como siempre.
 */
export async function readSessionUserId(
  client: SupabaseClient,
  cache: SessionCache = sharedSessionCache,
): Promise<string | null> {
  const accessToken = await readAccessToken(client);
  if (accessToken === null) {
    return null;
  }
  const remembered = cache.readUserId(accessToken);
  return remembered === null ? readAuthenticatedUserId(client) : remembered;
}
