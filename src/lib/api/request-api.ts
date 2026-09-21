import type { z } from "zod";
import {
  type RequestFailure,
  readRequestFailure,
} from "@/components/auth/request-failure";
import { readStringAt } from "./read-string-at";

/**
 * Una petición de una pantalla a la API v1, reducida a "el cuerpo que
 * respondió" o "por qué no". El detalle técnico de un fallo de red no le sirve
 * a quien mira la pantalla, así que no sale de aquí.
 *
 * De un error se guarda el código y no la frase: la frase se arma al pintar,
 * en el idioma de la pantalla (E17). Todo pasa por los endpoints y nada por la
 * base, porque la aplicación nativa de Release 2 va a usar exactamente estos
 * mismos caminos (CON-002).
 */

export const JSON_REQUEST_HEADERS = { "content-type": "application/json" };

/** Por qué no salió una petición. `reason` es el del cuerpo de un error de la
 * convención, que distingue qué regla se incumplió. */
export type ApiRequestFailure = {
  readonly kind: "failed";
  readonly failure: RequestFailure;
  readonly reason: string | null;
};

export type ApiRequestOutcome =
  { readonly kind: "ok"; readonly payload: unknown } | ApiRequestFailure;

/** Una respuesta que no sigue la convención de la API. La pantalla no puede
 * enseñar un estado que no sabe leer. */
export const UNRECOGNIZED_RESPONSE: ApiRequestFailure = {
  kind: "failed",
  failure: "unrecognized_response",
  reason: null,
};

export async function requestApi(
  path: string,
  init?: RequestInit,
): Promise<ApiRequestOutcome> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    return { kind: "failed", failure: "network", reason: null };
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      kind: "failed",
      failure: readRequestFailure(payload),
      reason: readStringAt(payload, ["error", "reason"]),
    };
  }
  return { kind: "ok", payload };
}

/** El cuerpo de una respuesta, estrechado contra lo que la pantalla sabe
 * pintar. Un cuerpo que no cuadra no se adivina: vale tanto como un fallo.
 *
 * Vive aquí y no en cada cliente de pantalla porque ya iba por la tercera
 * copia (grupos, administración y el directorio de #239), que es donde
 * CLAUDE.md pide extraer. */
export function readApiPayload<Value>(
  outcome: ApiRequestOutcome,
  schema: z.ZodType<Value>,
): { readonly kind: "ok"; readonly value: Value } | ApiRequestFailure {
  if (outcome.kind === "failed") {
    return outcome;
  }
  const parsed = schema.safeParse(outcome.payload);
  return parsed.success
    ? { kind: "ok", value: parsed.data }
    : UNRECOGNIZED_RESPONSE;
}
