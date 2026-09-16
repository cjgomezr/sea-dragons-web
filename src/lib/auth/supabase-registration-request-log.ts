import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RegistrationRequestLog,
  RegistrationSubject,
} from "./registration-rate-limit";

/**
 * El adaptador del límite del registro (migración 0010). Es de servidor: va
 * por la llave de servicio, la única que puede leer y escribir esa tabla.
 */

const REGISTRATION_REQUESTS_TABLE = "registration_requests";

/** Separa los dos espacios de sujetos dentro del hash: sin esto, una dirección
 * y una IP con el mismo texto compartirían contador. */
const SUBJECT_HASH_DOMAIN = "victoria-seadragons/registration-rate-limit";

/**
 * El hash con el que la tabla reconoce un sujeto.
 *
 * Con clave, y no un SHA-256 a secas como el de `0006`: aquí lo que se guarda
 * puede ser una IP, y el espacio entero de las IPv4 se recorre en segundos, así
 * que un hash sin clave es la IP en claro con pasos extra. La clave es la de
 * servicio del proyecto, que ya hace falta para escribir en esta tabla; un
 * volcado de la base sin ella no dice de quién era ninguna fila.
 */
export function hashRegistrationSubject(
  subject: RegistrationSubject,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${SUBJECT_HASH_DOMAIN}/${subject.kind}:${subject.value}`)
    .digest("hex");
}

export function createSupabaseRegistrationRequestLog(
  serviceClient: SupabaseClient,
  target: { readonly clubId: string; readonly hashSecret: string },
): RegistrationRequestLog {
  const { clubId, hashSecret } = target;
  return {
    async recordAndCountRecent({ subject, now, windowStart }) {
      const subjectHash = hashRegistrationSubject(subject, hashSecret);
      // Anotar va antes de contar: si no, dos peticiones a la vez leerían las
      // dos el mismo contador por debajo del tope y pasarían las dos.
      const { error: insertError } = await serviceClient
        .from(REGISTRATION_REQUESTS_TABLE)
        .insert({
          club_id: clubId,
          subject_kind: subject.kind,
          subject_hash: subjectHash,
          requested_at: now.toISOString(),
        });
      if (insertError) {
        throw new Error(
          `No se pudo anotar la petición en ${REGISTRATION_REQUESTS_TABLE}: ${insertError.message}`,
        );
      }

      const { count, error } = await serviceClient
        .from(REGISTRATION_REQUESTS_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("subject_kind", subject.kind)
        .eq("subject_hash", subjectHash)
        .gte("requested_at", windowStart.toISOString());
      if (error) {
        throw new Error(
          `No se pudieron contar las peticiones de ${REGISTRATION_REQUESTS_TABLE}: ${error.message}`,
        );
      }
      if (count === null) {
        throw new Error(
          `La base no devolvió el número de peticiones de ${REGISTRATION_REQUESTS_TABLE}.`,
        );
      }
      return count;
    },
  };
}
