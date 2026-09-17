import {
  PENDING_REQUIREMENTS,
  type PendingRequirement,
} from "@/lib/auth/account-activation";
import type { Translator } from "@/lib/i18n/translator";
import { type RequestFailure, readRequestFailure } from "./request-failure";

/**
 * Lo que comparten los dos formularios de completar registro al hablar con la
 * API de la cuenta: mandar, leer la respuesta sin fiarse de su forma, y
 * reducirla a lo que la pantalla necesita saber.
 */

/** Lee lo que haya en una ruta de un JSON que llega como unknown, sin confiar
 * en su forma: la respuesta viene de la red y podría ser cualquier cosa. */
function readValueAt(payload: unknown, path: readonly string[]): unknown {
  let current: unknown = payload;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** La lista de pendientes que devuelve el servidor, estrechada contra la lista
 * del dominio. Se compara contra `PENDING_REQUIREMENTS` y no contra una copia
 * local: con una copia, el pendiente que se añadiera mañana llegaría del
 * servidor y la pantalla lo descartaría en silencio, dejando a alguien
 * mirando una pantalla sin nada que hacer. */
function readPending(payload: unknown): readonly PendingRequirement[] {
  const value = readValueAt(payload, ["data", "pending"]);
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const known = PENDING_REQUIREMENTS.find(
      (requirement) => requirement === item,
    );
    return known === undefined ? [] : [known];
  });
}

export type AccountRequestResult =
  | { readonly kind: "completed" }
  | {
      readonly kind: "pending";
      readonly pending: readonly PendingRequirement[];
    }
  | { readonly kind: "failed"; readonly failure: RequestFailure };

/** Lo que los dos endpoints de la cuenta responden cuando no aceptan: sin
 * sesión (401), una sesión sin socio (403), una cuenta que ya no necesita lo
 * que se manda (409) o datos que el dominio rechaza (422). Los dos formularios
 * validan antes con la misma regla que el servidor, así que el 422 sólo llega
 * si los dos lados discrepan, y no hay campo concreto que señalar. */
export function describeAccountFailure(
  translate: Translator,
  failure: RequestFailure,
): string {
  switch (failure) {
    case "network":
      return translate("auth.error.network");
    case "unauthenticated":
      return translate("auth.completion.signInRequired");
    case "forbidden":
      return translate("auth.completion.notAMember");
    case "conflict":
      return translate("auth.completion.noLongerNeeded");
    case "business_rule":
      return translate("auth.completion.rejected");
    default:
      return translate("auth.completion.unexpected");
  }
}

export async function sendAccountRequest(request: {
  readonly path: string;
  readonly method: "PATCH" | "POST";
  readonly body: unknown;
}): Promise<AccountRequestResult> {
  let response: Response;
  try {
    response = await fetch(request.path, {
      method: request.method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request.body),
    });
  } catch {
    // El detalle técnico no le sirve a nadie que esté mirando un formulario, y
    // puede nombrar hosts internos.
    return { kind: "failed", failure: "network" };
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return { kind: "failed", failure: readRequestFailure(payload) };
  }

  return readValueAt(payload, ["data", "accountStatus"]) === "active"
    ? { kind: "completed" }
    : { kind: "pending", pending: readPending(payload) };
}
