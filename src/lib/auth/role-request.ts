import { MemberNotFoundError } from "./account-activation";
import type { Role } from "./roles";

/**
 * Pedir Coach o Committee desde Mi cuenta (FR-010, RF-4 del PRD de E3),
 * contado sin Supabase delante.
 *
 * La regla de una sola solicitud pendiente por socio vive en la base, en el
 * índice único parcial de `0012_role_requests.sql`. La comprobación previa de
 * aquí sólo sirve para responder sin intentar la escritura: dos peticiones
 * simultáneas la pasan las dos, y la segunda choca con el índice. Los dos
 * caminos acaban en el mismo conflicto.
 */

/** Admin no se pide (lo da otro Admin) y Player ya lo tiene todo el mundo. Son
 * los mismos dos que acepta el `check` de `role_requests.requested_role`. */
export const REQUESTABLE_ROLES = [
  "Coach",
  "Committee",
] as const satisfies readonly Role[];

export type RequestableRole = (typeof REQUESTABLE_ROLES)[number];

/** El mismo límite que el `check` de `role_requests.justification`. */
export const JUSTIFICATION_MAX_LENGTH = 500;

export const ROLE_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
] as const;

export type RoleRequestStatus = (typeof ROLE_REQUEST_STATUSES)[number];

/** Una solicitud tal como la ve quien la hizo. La justificación no vuelve: la
 * pantalla no la enseña y quien la escribió ya la conoce. */
export type RoleRequest = {
  readonly id: string;
  readonly requestedRole: RequestableRole;
  readonly status: RoleRequestStatus;
  readonly createdAt: string;
};

export type RoleRequestMember = {
  readonly clubId: string;
  readonly fullName: string;
  readonly role: Role;
};

export type NewRoleRequest = {
  readonly clubId: string;
  readonly userId: string;
  readonly requestedRole: RequestableRole;
  readonly justification: string | null;
};

/** `pending_exists` es el choque con el índice único: otra petición del mismo
 * socio guardó la suya entre la comprobación previa y esta escritura. */
export type RoleRequestInsert =
  | { readonly kind: "created"; readonly request: RoleRequest }
  | { readonly kind: "pending_exists" };

export type RoleRequestGateways = {
  readonly members: {
    findRoleRequestMember(userId: string): Promise<RoleRequestMember | null>;
  };
  readonly requests: {
    findLatestRequest(userId: string): Promise<RoleRequest | null>;
    insertPendingRequest(request: NewRoleRequest): Promise<RoleRequestInsert>;
  };
};

/** Por qué no se puede pedir un rol aunque la petición esté bien formada. Es
 * estable como un código: la pantalla lo traduce. */
export type RoleRequestRefusal =
  "admin_has_every_capability" | "role_already_held";

export class RoleRequestRefusedError extends Error {
  readonly reason: RoleRequestRefusal;

  constructor(reason: RoleRequestRefusal) {
    super(
      reason === "admin_has_every_capability"
        ? "Un Admin ya tiene todas las capacidades: no tiene ningún rol que pedir."
        : "Ya tienes ese rol.",
    );
    this.name = "RoleRequestRefusedError";
    this.reason = reason;
  }
}

export class PendingRoleRequestError extends Error {
  constructor() {
    super(
      "Ya tienes una solicitud de rol pendiente. Espera la respuesta antes de pedir otra.",
    );
    this.name = "PendingRoleRequestError";
  }
}

export class JustificationTooLongError extends Error {
  constructor() {
    super(
      `La justificación no puede pasar de ${JUSTIFICATION_MAX_LENGTH} caracteres.`,
    );
    this.name = "JustificationTooLongError";
  }
}

/** Lo que llega de fuera, estrechado sin normalizar: `"coach"` no es un rol
 * que se pueda pedir, igual que no es un rol en `parseRole`. */
export function parseRequestableRole(value: unknown): RequestableRole | null {
  return REQUESTABLE_ROLES.find((role) => role === value) ?? null;
}

/** Cuenta caracteres como `char_length` en la base, no unidades UTF-16: un
 * emoji es uno. Con `length`, el formulario rechazaría lo que la base acepta. */
function countCharacters(text: string): number {
  return [...text].length;
}

/** Lo que se guarda de la justificación: sin espacios en los extremos, y nada
 * cuando no queda texto. */
function normalizeJustification(text: string | null): string | null {
  const trimmed = text?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** La usan el formulario, para avisar antes de enviar, y el dominio, para
 * rechazar lo que llegue sin pasar por el formulario. */
export function isJustificationTooLong(text: string): boolean {
  return countCharacters(text.trim()) > JUSTIFICATION_MAX_LENGTH;
}

/** Qué puede hacer un socio en Mi cuenta: nada, esperar la respuesta a su
 * solicitud, o pedir alguno de los roles que todavía no tiene. */
export type RoleRequestAvailability =
  | { readonly kind: "not_needed" }
  | { readonly kind: "pending"; readonly request: RoleRequest }
  | { readonly kind: "available"; readonly roles: readonly RequestableRole[] };

export function roleRequestAvailability(
  role: Role,
  latestRequest: RoleRequest | null,
): RoleRequestAvailability {
  // Un Admin va primero: aprobar cualquier solicitud suya lo degradaría.
  if (role === "Admin") {
    return { kind: "not_needed" };
  }
  if (latestRequest?.status === "pending") {
    return { kind: "pending", request: latestRequest };
  }
  return {
    kind: "available",
    roles: REQUESTABLE_ROLES.filter((requestable) => requestable !== role),
  };
}

function assertRoleCanBeRequested(
  role: Role,
  requestedRole: RequestableRole,
): void {
  if (role === "Admin") {
    throw new RoleRequestRefusedError("admin_has_every_capability");
  }
  if (role === requestedRole) {
    throw new RoleRequestRefusedError("role_already_held");
  }
}

async function findMember(
  gateways: RoleRequestGateways,
  userId: string,
): Promise<RoleRequestMember> {
  const member = await gateways.members.findRoleRequestMember(userId);
  if (member === null) {
    throw new MemberNotFoundError(userId);
  }
  return member;
}

/** Guarda una solicitud pendiente de quien llama. Lo barato va primero: la
 * justificación no necesita la base, y el rol se decide con la fila del socio
 * antes de buscar solicitudes. */
export async function requestRole(
  gateways: RoleRequestGateways,
  input: {
    readonly userId: string;
    readonly requestedRole: RequestableRole;
    readonly justification: string | null;
  },
): Promise<RoleRequest> {
  if (
    input.justification !== null &&
    isJustificationTooLong(input.justification)
  ) {
    throw new JustificationTooLongError();
  }

  const member = await findMember(gateways, input.userId);
  assertRoleCanBeRequested(member.role, input.requestedRole);

  const latest = await gateways.requests.findLatestRequest(input.userId);
  if (latest?.status === "pending") {
    throw new PendingRoleRequestError();
  }

  const insert = await gateways.requests.insertPendingRequest({
    clubId: member.clubId,
    userId: input.userId,
    requestedRole: input.requestedRole,
    justification: normalizeJustification(input.justification),
  });
  if (insert.kind === "pending_exists") {
    throw new PendingRoleRequestError();
  }
  return insert.request;
}

/** Lo que Mi cuenta enseña de quien la abre. */
export type RoleRequestAccount = {
  readonly fullName: string;
  readonly role: Role;
  readonly latestRequest: RoleRequest | null;
};

export async function describeRoleRequestAccount(
  gateways: RoleRequestGateways,
  userId: string,
): Promise<RoleRequestAccount> {
  const member = await findMember(gateways, userId);
  return {
    fullName: member.fullName,
    role: member.role,
    latestRequest: await gateways.requests.findLatestRequest(userId),
  };
}
