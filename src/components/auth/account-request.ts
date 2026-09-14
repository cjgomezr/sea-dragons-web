import {
  PENDING_REQUIREMENTS,
  type PendingRequirement,
} from "@/lib/auth/account-activation";

/**
 * Lo que comparten los dos formularios de completar registro al hablar con la
 * API de la cuenta: mandar, leer la respuesta sin fiarse de su forma, y
 * reducirla a lo que la pantalla necesita saber.
 */

export const NETWORK_ERROR_MESSAGE =
  "No pudimos hablar con el servidor. Revisa tu conexión y vuelve a intentarlo.";
export const UNEXPECTED_ERROR_MESSAGE =
  "No pudimos guardar tus datos. Vuelve a intentarlo en un momento.";

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

function readStringAt(
  payload: unknown,
  path: readonly string[],
): string | null {
  const value = readValueAt(payload, path);
  return typeof value === "string" ? value : null;
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
  | { readonly kind: "failed"; readonly message: string };

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
    return { kind: "failed", message: NETWORK_ERROR_MESSAGE };
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      kind: "failed",
      message:
        readStringAt(payload, ["error", "message"]) ?? UNEXPECTED_ERROR_MESSAGE,
    };
  }

  return readStringAt(payload, ["data", "accountStatus"]) === "active"
    ? { kind: "completed" }
    : { kind: "pending", pending: readPending(payload) };
}
