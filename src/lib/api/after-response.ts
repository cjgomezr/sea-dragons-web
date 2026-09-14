import { after } from "next/server";

/**
 * Deja trabajo para después de enviar la respuesta.
 *
 * Existe para una sola cosa: que lo que tarda una respuesta no dependa de algo
 * que sólo ocurre para ciertas cuentas, como mandar un correo. Si la respuesta
 * lo esperara, el tiempo delataría qué direcciones tienen cuenta.
 *
 * Es un módulo aparte porque `after` lanza fuera de una petición real de
 * Next.js, y así los tests de las rutas lo pueden sustituir.
 */
export function runAfterResponse(work: () => Promise<void>): void {
  after(work);
}
