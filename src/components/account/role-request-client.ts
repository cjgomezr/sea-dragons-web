import { readStringAt } from "@/lib/api/read-string-at";
import {
  ROLE_REQUEST_STATUSES,
  type RequestableRole,
  type RoleRequest,
  parseRequestableRole,
} from "@/lib/auth/role-request";
import { ROLE_REQUESTS_API_PATH } from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import {
  type RequestFailure,
  readRequestFailure,
} from "@/components/auth/request-failure";

/**
 * Mandar una solicitud de rol y reducir la respuesta a lo que Mi cuenta
 * necesita: la solicitud creada, o por qué no salió. Como en los formularios
 * de cuentas, se guarda el código y no la frase, para que el aviso cambie de
 * idioma con el interruptor.
 */

export type RoleRequestSubmission =
  | { readonly kind: "created"; readonly request: RoleRequest }
  | {
      readonly kind: "failed";
      readonly failure: RequestFailure;
      /** El `reason` de un 422, que distingue qué regla se incumplió. */
      readonly reason: string | null;
    };

/** La solicitud que devuelve un 201, sin fiarse de su forma: si algo no
 * cuadra, la pantalla no puede enseñar un estado inventado. */
function readCreatedRequest(payload: unknown): RoleRequest | null {
  const id = readStringAt(payload, ["data", "id"]);
  const createdAt = readStringAt(payload, ["data", "createdAt"]);
  const requestedRole = parseRequestableRole(
    readStringAt(payload, ["data", "requestedRole"]),
  );
  const statusValue = readStringAt(payload, ["data", "status"]);
  const status = ROLE_REQUEST_STATUSES.find(
    (candidate) => candidate === statusValue,
  );
  if (
    id === null ||
    createdAt === null ||
    requestedRole === null ||
    status === undefined
  ) {
    return null;
  }
  return { id, requestedRole, status, createdAt };
}

export async function submitRoleRequest(body: {
  readonly requestedRole: RequestableRole;
  readonly justification: string;
}): Promise<RoleRequestSubmission> {
  let response: Response;
  try {
    response = await fetch(ROLE_REQUESTS_API_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // El detalle técnico no le sirve a quien mira el formulario.
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
  const request = readCreatedRequest(payload);
  return request === null
    ? { kind: "failed", failure: "unrecognized_response", reason: null }
    : { kind: "created", request };
}

/** Lo que el servidor puede responder que no, en el idioma de la pantalla. El
 * 400 sólo llega si el formulario y el servidor discrepan, y lo único que el
 * formulario deja escribir mal es el largo de la justificación. */
export function describeRoleRequestFailure(
  translate: Translator,
  failure: RequestFailure,
  reason: string | null,
  maxJustificationLength: number,
): string {
  switch (failure) {
    case "network":
      return translate("auth.error.network");
    case "conflict":
      return translate("account.error.pending");
    case "business_rule":
      return reason === "admin_has_every_capability"
        ? translate("account.adminNote")
        : translate("account.error.roleAlreadyHeld");
    case "validation_error":
      return translate("account.request.justificationTooLong", {
        max: maxJustificationLength,
      });
    case "unauthenticated":
      return translate("account.error.signInRequired");
    case "forbidden":
      return translate("account.error.forbidden");
    default:
      return translate("account.error.unexpected");
  }
}
