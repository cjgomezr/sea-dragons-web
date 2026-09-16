import { readStringAt } from "./read-string-at";

/** Los códigos de error de la convención de la API v1. Viven aparte de
 * `response.ts` porque las pantallas también los leen, y ese módulo arrastra
 * `next/server`. Una pantalla traduce el error a partir de su código, no de la
 * frase que llega, que el servidor escribe en un solo idioma (E17). */
export const API_ERROR_CODES = [
  "validation_error",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "business_rule",
  // Un recurso que existió y ya no sirve, como un enlace de un solo uso ya
  // canjeado o caducado. No es un 404: el cliente tiene que ofrecer pedir otro.
  "gone",
  // Demasiadas peticiones seguidas. Se responde pidiendo esperar, nunca en
  // silencio (RF-6 de E2).
  "rate_limited",
  "method_not_allowed",
  "service_unavailable",
  "internal_error",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** El código de una respuesta de error, estrechado contra la convención. Un
 * código desconocido, o una respuesta que no es de la API (la página de un
 * proxy caído), no es ninguno: la pantalla dice entonces su error genérico. */
export function readApiErrorCode(payload: unknown): ApiErrorCode | null {
  const code = readStringAt(payload, ["error", "code"]);
  return API_ERROR_CODES.find((known) => known === code) ?? null;
}
