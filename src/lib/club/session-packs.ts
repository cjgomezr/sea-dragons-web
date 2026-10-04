import { type AuditLogWriter, recordAuditEvent } from "@/lib/audit/audit-log";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { RoleRequestMember } from "@/lib/auth/role-request";
import { hasCapability } from "@/lib/auth/roles";
import type { ClubPrice } from "@/lib/membership/stripe-prices";
import type { ClubSettingsGateways } from "./club-settings";

/**
 * Los packs de sesiones que el club ofrece a sus Casual (#469, RF-4 del PRD
 * de E13, D2 y FR-080), contados sin Supabase delante. Cualquier cuenta
 * activa los lee; el Admin y el Committee cambian la lista entera.
 *
 * Un pack es sólo un número de sesiones. Lo que cuesta sale del `Price` de la
 * sesión Casual en Stripe por ese número (#486): sin descuentos por volumen
 * (ASS-007), y nunca un importe escrito aquí.
 */

/** Los límites de `club_session_pack_options_sessions_check` en `0056`. */
export const MIN_PACK_SESSIONS = 1;
export const MAX_PACK_SESSIONS = 50;

export const SESSION_PACK_ISSUE_CODES = [
  "packs_required",
  "pack_sessions_out_of_range",
  "pack_sessions_repeated",
] as const;

export type SessionPackIssueCode = (typeof SESSION_PACK_ISSUE_CODES)[number];

export type SessionPackOffer = {
  readonly sessions: number;
  /** El del pack entero, o nulo con su motivo si Stripe no da el de la
   * sesión. */
  readonly price: ClubPrice;
};

export type SessionPackOffers = readonly SessionPackOffer[];

export type SessionPacksGateways = {
  readonly members: ClubSettingsGateways["members"];
  readonly packs: {
    /** Los tamaños del club, en el orden en que se ofrecen. */
    findPackSizes(clubId: string): Promise<readonly number[]>;
    /** Cambia la lista entera de una vez. */
    replacePackSizes(clubId: string, sizes: readonly number[]): Promise<void>;
  };
  readonly sessionPrice: {
    readCasualSessionPrice(): Promise<ClubPrice>;
  };
  readonly audit: AuditLogWriter;
};

export class SessionPacksForbiddenError extends Error {
  constructor() {
    super("Sólo un Admin o un Committee puede cambiar los packs de sesiones.");
    this.name = "SessionPacksForbiddenError";
  }
}

export class SessionPacksValidationError extends Error {
  readonly code: SessionPackIssueCode;

  constructor(code: SessionPackIssueCode) {
    super(`La lista de packs no vale: ${code}.`);
    this.name = "SessionPacksValidationError";
    this.code = code;
  }
}

function isWithinRange(sessions: number): boolean {
  return (
    Number.isInteger(sessions) &&
    sessions >= MIN_PACK_SESSIONS &&
    sessions <= MAX_PACK_SESSIONS
  );
}

/** El primer problema de la lista, o nulo si vale. La pantalla la usa antes
 * de guardar y el servidor la repite. */
export function findSessionPackIssue(
  sizes: readonly number[],
): SessionPackIssueCode | null {
  if (sizes.length === 0) {
    return "packs_required";
  }
  if (!sizes.every(isWithinRange)) {
    return "pack_sessions_out_of_range";
  }
  if (new Set(sizes).size !== sizes.length) {
    return "pack_sessions_repeated";
  }
  return null;
}

/** El precio de un pack: el de una sesión por cuántas trae. */
export function priceSessionPack(
  sessionPrice: ClubPrice,
  sessions: number,
): ClubPrice {
  if (sessionPrice.amountCents === null) {
    return sessionPrice;
  }
  return { ...sessionPrice, amountCents: sessionPrice.amountCents * sessions };
}

async function findCaller(
  gateways: SessionPacksGateways,
  callerId: string,
): Promise<RoleRequestMember> {
  const caller = await gateways.members.findRoleRequestMember(callerId);
  if (caller === null) {
    throw new MemberNotFoundError(callerId);
  }
  return caller;
}

async function readOffers(
  gateways: SessionPacksGateways,
  clubId: string,
): Promise<SessionPackOffers> {
  const [sizes, sessionPrice] = await Promise.all([
    gateways.packs.findPackSizes(clubId),
    gateways.sessionPrice.readCasualSessionPrice(),
  ]);
  return sizes.map((sessions) => ({
    sessions,
    price: priceSessionPack(sessionPrice, sessions),
  }));
}

export async function listSessionPacks(
  gateways: SessionPacksGateways,
  callerId: string,
): Promise<SessionPackOffers> {
  const caller = await findCaller(gateways, callerId);
  return readOffers(gateways, caller.clubId);
}

/** Valida antes de leer nada y anota después de escribir: auditar primero
 * dejaría rastro de un cambio que no se guardó. La bitácora lleva los
 * tamaños, que no son datos de nadie. */
export async function replaceSessionPacks(
  gateways: SessionPacksGateways,
  request: { readonly callerId: string; readonly sizes: readonly number[] },
): Promise<SessionPackOffers> {
  const issue = findSessionPackIssue(request.sizes);
  if (issue !== null) {
    throw new SessionPacksValidationError(issue);
  }
  const caller = await findCaller(gateways, request.callerId);
  if (!hasCapability(caller.role, "configureSessionPacks")) {
    throw new SessionPacksForbiddenError();
  }
  await gateways.packs.replacePackSizes(caller.clubId, request.sizes);
  await recordAuditEvent(gateways.audit, {
    actor: { id: request.callerId, clubId: caller.clubId },
    clubId: caller.clubId,
    action: "club.session_packs_changed",
    entityType: "club",
    entityId: caller.clubId,
    result: "success",
    metadata: { sessions: request.sizes },
  });
  return readOffers(gateways, caller.clubId);
}
