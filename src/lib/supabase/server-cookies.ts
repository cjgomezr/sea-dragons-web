import { cookies } from "next/headers";
import type { IncomingCookie } from "./session-client";

/**
 * Las cookies de la petición vistas desde un Server Component.
 *
 * Es la misma lista que `readIncomingCookies` saca de una `NextRequest`, leída
 * por la otra API que Next ofrece. Vive en su propio archivo porque
 * `next/headers` sólo existe en el servidor, y `session-client.ts` lo importa
 * también el proxy.
 *
 * Lo que aquí NO se puede hacer es escribirlas: un Server Component no pone
 * cabeceras. No hace falta: el proxy ya validó la sesión de esta misma
 * petición y volcó en su respuesta cualquier token refrescado.
 */
export async function readServerCookies(): Promise<readonly IncomingCookie[]> {
  const store = await cookies();
  return store.getAll().map(({ name, value }) => ({ name, value }));
}
