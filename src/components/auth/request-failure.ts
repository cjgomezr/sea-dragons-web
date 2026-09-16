import { type ApiErrorCode, readApiErrorCode } from "@/lib/api/error-codes";

/**
 * Por qué no salió una petición de un formulario de cuentas: no llegó al
 * servidor, el servidor respondió con un código de la convención, o respondió
 * algo que no la sigue.
 *
 * Los formularios guardan esto y no una frase. La frase se arma al pintar, en
 * el idioma de la pantalla, y así un aviso que ya está a la vista cambia de
 * idioma con el interruptor en vez de quedarse en el de antes (E17).
 */
export type RequestFailure = "network" | "unrecognized_response" | ApiErrorCode;

export function readRequestFailure(payload: unknown): RequestFailure {
  return readApiErrorCode(payload) ?? "unrecognized_response";
}
