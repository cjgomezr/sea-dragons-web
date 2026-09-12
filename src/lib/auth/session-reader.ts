import { isAuthSessionMissingError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionState } from "./session-boundary";
import { createAccountStatusGateway } from "./supabase-session-gateways";

/**
 * Quién está pidiendo algo, en los términos que la frontera entiende.
 *
 * Son dos preguntas seguidas y las dos viajan a Supabase. La primera usa
 * `getUser()`, que pregunta al servidor de autenticación en vez de verificar
 * el token en local: una sesión recién cerrada deja un token que todavía no ha
 * caducado, y verificarlo en local lo daría por bueno. La segunda lee la fila
 * de miembro, porque una cuenta `incomplete` tiene sesión válida y aun así no
 * puede operar (FR-083). Ese es el precio de que cerrar sesión signifique algo
 * y de que la puerta del registro a medias esté en el servidor.
 */

/** La identidad de quien pide, o `null` si no hay ninguna sesión que valga.
 * Lo usan la frontera, para saber a quién mirarle el estado de la cuenta, y
 * los endpoints que actúan sobre la cuenta de quien llama. */
export async function readAuthenticatedUserId(
  client: SupabaseClient,
): Promise<string | null> {
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
  return data.user?.id ?? null;
}

export async function readSessionState(
  client: SupabaseClient,
): Promise<SessionState> {
  const userId = await readAuthenticatedUserId(client);
  if (userId === null) {
    return "anonymous";
  }

  try {
    const status =
      await createAccountStatusGateway(client).findAccountStatus(userId);
    // `inactive` (una baja de socio) y la identidad sin fila de miembro no
    // abren ninguna puerta, así que son lo mismo que no tener sesión.
    return status === "active" || status === "incomplete"
      ? status
      : "anonymous";
  } catch (error) {
    // Una frontera que se cae hacia el lado abierto cuando la base no contesta
    // no es una frontera. Se niega el paso y se deja escrito por qué.
    console.error(
      "[sesión] no se pudo leer el estado de la cuenta:",
      error instanceof Error ? error.message : String(error),
    );
    return "anonymous";
  }
}
