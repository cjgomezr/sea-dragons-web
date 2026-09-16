import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailSendBudget } from "./email-delivery-availability";

/**
 * El adaptador del cupo propio de correos (migración 0009). Es de servidor: va
 * por la llave de servicio, la única que puede leer y escribir esa tabla.
 */

const EMAIL_SEND_REQUESTS_TABLE = "email_send_requests";

/** Cuenta las filas de todos los clubes a propósito: el cupo del proveedor es
 * de la cuenta de Resend del proyecto, no de cada club. `clubId` sólo firma la
 * fila nueva (NFR-009). */
export function createSupabaseEmailSendBudget(
  serviceClient: SupabaseClient,
  clubId: string,
): EmailSendBudget {
  return {
    async countSince(windowStart) {
      const { count, error } = await serviceClient
        .from(EMAIL_SEND_REQUESTS_TABLE)
        .select("id", { count: "exact", head: true })
        .gte("requested_at", windowStart.toISOString());
      if (error) {
        throw new Error(
          `No se pudieron contar las peticiones de ${EMAIL_SEND_REQUESTS_TABLE}: ${error.message}`,
        );
      }
      if (count === null) {
        throw new Error(
          `La base no devolvió el número de peticiones de ${EMAIL_SEND_REQUESTS_TABLE}.`,
        );
      }
      return count;
    },

    async recordRequest(now) {
      const { error } = await serviceClient
        .from(EMAIL_SEND_REQUESTS_TABLE)
        .insert({ club_id: clubId, requested_at: now.toISOString() });
      if (error) {
        throw new Error(
          `No se pudo anotar la petición en ${EMAIL_SEND_REQUESTS_TABLE}: ${error.message}`,
        );
      }
    },
  };
}
