import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailRequestLog } from "./email-request-log";

/**
 * El adaptador de los límites de peticiones por correo. Es de servidor: va por
 * la llave de servicio, porque nadie más puede leer ni escribir esas tablas
 * (migraciones 0005 y 0006).
 */

/** El hash con el que las tablas de límites reconocen un correo. Ver la
 * migración 0005 para por qué no se guarda el correo. */
export function hashEmailForRequestLog(email: string): string {
  return createHash("sha256").update(email).digest("hex");
}

export function createSupabaseEmailRequestLog(
  serviceClient: SupabaseClient,
  target: { readonly table: string; readonly clubId: string },
): EmailRequestLog {
  const { table, clubId } = target;
  return {
    async recordAndCountRecent({ email, now, windowStart }) {
      const emailHash = hashEmailForRequestLog(email);
      const { error: insertError } = await serviceClient.from(table).insert({
        club_id: clubId,
        email_hash: emailHash,
        requested_at: now.toISOString(),
      });
      if (insertError) {
        throw new Error(
          `No se pudo anotar la petición en ${table}: ${insertError.message}`,
        );
      }

      const { count, error } = await serviceClient
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("email_hash", emailHash)
        .gte("requested_at", windowStart.toISOString());
      if (error) {
        throw new Error(
          `No se pudieron contar las peticiones de ${table}: ${error.message}`,
        );
      }
      if (count === null) {
        throw new Error(
          `La base no devolvió el número de peticiones de ${table}.`,
        );
      }
      return count;
    },
  };
}
