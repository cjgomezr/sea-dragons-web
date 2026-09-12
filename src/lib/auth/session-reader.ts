import { isAuthSessionMissingError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Si quien pide tiene una sesión que el servidor de autenticación reconoce
 * ahora mismo.
 *
 * Usa `getUser()`, que pregunta a Supabase, y no la verificación local del
 * token. La diferencia es la que pide el ticket: una sesión recién cerrada
 * deja un token que todavía no ha caducado, y verificarlo en local lo daría
 * por bueno. `getUser()` ve que la sesión ya no existe y responde que no.
 * Cuesta una ida y vuelta por petición, y ese es el precio de que cerrar
 * sesión signifique algo.
 */
export async function hasValidSession(
  client: SupabaseClient,
): Promise<boolean> {
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
    return false;
  }
  return data.user !== null;
}
