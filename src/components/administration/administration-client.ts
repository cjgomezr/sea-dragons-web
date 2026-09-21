import { z } from "zod";
import type { RequestFailure } from "@/components/auth/request-failure";
import {
  type ApiRequestFailure,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import type {
  ClubMember,
  PendingRoleRequest,
} from "@/lib/auth/club-administration";
import { REQUESTABLE_ROLES } from "@/lib/auth/role-request";
import type { RoleRequestDecision } from "@/lib/auth/role-request-decision";
import { ROLES, type Role } from "@/lib/auth/roles";
import {
  MEMBERS_API_PATH,
  MEMBER_ROLE_API_PATH,
  ROLE_REQUESTS_API_PATH,
  ROLE_REQUEST_DECISION_API_PATH,
} from "@/lib/auth/routes";
import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Lo que la pantalla de administración le pide a la API v1 y cómo reduce cada
 * respuesta a algo que pintar.
 *
 * Todo pasa por los endpoints y nada por la base: la aplicación nativa de
 * Release 2 va a usar exactamente estos mismos caminos (CON-002). Como en los
 * formularios de cuentas, de un error se guarda el código y no la frase: la
 * frase se arma al pintar, en el idioma de la pantalla (E17).
 */

const PENDING_REQUESTS_PATH = `${ROLE_REQUESTS_API_PATH}?status=pending`;

const clubMembersSchema = z.object({
  data: z.object({
    members: z.array(
      z.object({
        userId: z.string(),
        fullName: z.string(),
        email: z.string(),
        role: z.enum(ROLES),
      }),
    ),
  }),
});

const pendingRequestsSchema = z.object({
  data: z.object({
    requests: z.array(
      z.object({
        id: z.string(),
        userId: z.string(),
        fullName: z.string(),
        requestedRole: z.enum(REQUESTABLE_ROLES),
        justification: z.string().nullable(),
        createdAt: z.string(),
      }),
    ),
  }),
});

const memberRoleSchema = z.object({ data: z.object({ role: z.enum(ROLES) }) });

/** Por qué no salió una petición de esta pantalla. */
export type AdministrationFailure = ApiRequestFailure;

export type AdministrationData = {
  readonly requests: readonly PendingRoleRequest[];
  readonly members: readonly ClubMember[];
};

export type AdministrationLoad =
  | { readonly kind: "loaded"; readonly data: AdministrationData }
  | AdministrationFailure;

export type DecisionOutcome =
  { readonly kind: "decided" } | AdministrationFailure;

export type RoleChangeOutcome =
  { readonly kind: "changed"; readonly role: Role } | AdministrationFailure;

export async function loadAdministration(): Promise<AdministrationLoad> {
  const [pending, members] = await Promise.all([
    requestApi(PENDING_REQUESTS_PATH),
    requestApi(MEMBERS_API_PATH),
  ]);
  if (pending.kind === "failed") {
    return pending;
  }
  if (members.kind === "failed") {
    return members;
  }

  const readRequests = readApiPayload(pending, pendingRequestsSchema);
  if (readRequests.kind === "failed") {
    return readRequests;
  }
  const readMembers = readApiPayload(members, clubMembersSchema);
  if (readMembers.kind === "failed") {
    return readMembers;
  }
  return {
    kind: "loaded",
    data: {
      requests: readRequests.value.data.requests,
      members: readMembers.value.data.members,
    },
  };
}

export async function submitRoleRequestDecision(
  requestId: string,
  decision: RoleRequestDecision,
): Promise<DecisionOutcome> {
  const outcome = await requestApi(
    ROLE_REQUEST_DECISION_API_PATH.replace("[id]", requestId),
    {
      method: "POST",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify({ decision }),
    },
  );
  return outcome.kind === "failed" ? outcome : { kind: "decided" };
}

export async function submitMemberRole(
  userId: string,
  role: Role,
): Promise<RoleChangeOutcome> {
  const outcome = await requestApi(
    MEMBER_ROLE_API_PATH.replace("[id]", userId),
    {
      method: "PATCH",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify({ role }),
    },
  );
  if (outcome.kind === "failed") {
    return outcome;
  }
  const read = readApiPayload(outcome, memberRoleSchema);
  return read.kind === "failed"
    ? read
    : { kind: "changed", role: read.value.data.role };
}

/** Una solicitud que el servidor dice que ya no está pendiente no vuelve a la
 * bandeja: la decidió otro Admin, o desapareció con el socio. */
export function isRequestSettled(failure: RequestFailure): boolean {
  return failure === "conflict" || failure === "not_found";
}

/** Si el servidor rechazó el cambio por lo que es, y no por un tropiezo:
 * volver a mandarlo daría exactamente la misma respuesta. */
export function isChangeRefused(failure: RequestFailure): boolean {
  return (
    failure === "business_rule" ||
    failure === "not_found" ||
    failure === "forbidden"
  );
}

/** Lo que la pantalla intentaba cuando el servidor dijo que no. Un mismo
 * código no significa lo mismo en las dos acciones: un 404 al decidir es una
 * solicitud que ya no está, y al cambiar un rol es un socio que ya no está. */
export type AdministrationAction = "decision" | "roleChange";

const NOT_FOUND_MESSAGES = {
  decision: "admin.error.gone",
  roleChange: "admin.error.memberGone",
} as const satisfies Readonly<Record<AdministrationAction, MessageKey>>;

type BusinessRuleMessageKey =
  | "admin.error.lastAdmin"
  | "admin.error.roleAlreadyGranted"
  | "admin.error.unexpected";

/** Las reglas que los endpoints de escritura nombran en `reason`. Una que no
 * esté aquí no se adivina: sale el aviso genérico. */
function businessRuleMessage(reason: string | null): BusinessRuleMessageKey {
  switch (reason) {
    case "last_admin":
      return "admin.error.lastAdmin";
    case "role_already_granted":
      return "admin.error.roleAlreadyGranted";
    default:
      return "admin.error.unexpected";
  }
}

/** Lo que el servidor puede responder que no, en el idioma de la pantalla. */
export function describeAdministrationFailure(
  translate: Translator,
  action: AdministrationAction,
  { failure, reason }: AdministrationFailure,
): string {
  switch (failure) {
    case "network":
      return translate("auth.error.network");
    case "conflict":
      return translate("admin.error.alreadyDecided");
    case "business_rule":
      return translate(businessRuleMessage(reason));
    case "not_found":
      return translate(NOT_FOUND_MESSAGES[action]);
    case "unauthenticated":
      return translate("admin.error.signInRequired");
    case "forbidden":
      return translate("admin.error.forbidden");
    default:
      return translate("admin.error.unexpected");
  }
}
