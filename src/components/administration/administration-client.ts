import { z } from "zod";
import {
  type RequestFailure,
  readRequestFailure,
} from "@/components/auth/request-failure";
import { readStringAt } from "@/lib/api/read-string-at";
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
const JSON_HEADERS = { "content-type": "application/json" };

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

/** Por qué no salió una petición de esta pantalla. `reason` es el del cuerpo
 * de un error de la convención, que distingue qué regla se incumplió. */
export type AdministrationFailure = {
  readonly kind: "failed";
  readonly failure: RequestFailure;
  readonly reason: string | null;
};

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

type FetchedPayload = { readonly kind: "ok"; readonly payload: unknown };

type FetchOutcome = FetchedPayload | AdministrationFailure;

/** Una petición a la API v1 reducida a "el cuerpo que respondió" o "por qué
 * no". El detalle técnico de un fallo de red no le sirve a quien mira la
 * pantalla, así que no sale de aquí. */
async function requestApi(
  path: string,
  init?: RequestInit,
): Promise<FetchOutcome> {
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

const UNRECOGNIZED: AdministrationFailure = {
  kind: "failed",
  failure: "unrecognized_response",
  reason: null,
};

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

  const parsedRequests = pendingRequestsSchema.safeParse(pending.payload);
  const parsedMembers = clubMembersSchema.safeParse(members.payload);
  if (!parsedRequests.success || !parsedMembers.success) {
    return UNRECOGNIZED;
  }
  return {
    kind: "loaded",
    data: {
      requests: parsedRequests.data.data.requests,
      members: parsedMembers.data.data.members,
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
      headers: JSON_HEADERS,
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
      headers: JSON_HEADERS,
      body: JSON.stringify({ role }),
    },
  );
  if (outcome.kind === "failed") {
    return outcome;
  }
  const parsed = memberRoleSchema.safeParse(outcome.payload);
  return parsed.success
    ? { kind: "changed", role: parsed.data.data.role }
    : UNRECOGNIZED;
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

/** Lo que el servidor puede responder que no, en el idioma de la pantalla. */
export function describeAdministrationFailure(
  translate: Translator,
  { failure, reason }: AdministrationFailure,
): string {
  switch (failure) {
    case "network":
      return translate("auth.error.network");
    case "conflict":
      return translate("admin.error.alreadyDecided");
    case "business_rule":
      return reason === "last_admin"
        ? translate("admin.error.lastAdmin")
        : translate("admin.error.roleAlreadyGranted");
    case "not_found":
      return translate("admin.error.gone");
    case "unauthenticated":
      return translate("admin.error.signInRequired");
    case "forbidden":
      return translate("admin.error.forbidden");
    default:
      return translate("admin.error.unexpected");
  }
}
