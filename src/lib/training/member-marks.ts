import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import type { Role } from "@/lib/auth/roles";
import {
  type MembershipBlock,
  type MembershipGateway,
  membershipBlockOf,
  readMembership,
} from "@/lib/membership/membership";

/**
 * Las marcas de cada socio (#899, RF-5 y D11 del PRD de E35): su 1RM en kg
 * para cada marca del club. Las lee y las escribe el servidor con la llave de
 * servicio, siempre acotado al socio de la sesión. Nadie más las ve, y el
 * valor no pasa nunca por la bitácora (D11), así que aquí no hay auditoría.
 * La puerta es la del plan: al día, o Admin o Coach (D2, D3).
 */

/** Los que planifican ven el plan aunque su membresía no esté al día (D3). */
const PLANNER_ROLES: ReadonlySet<Role> = new Set(["Admin", "Coach"]);

/** Más de 0 con un decimal: el menor valor que la base guarda sin volverlo 0. */
const MIN_MARK_VALUE = 0.1;
const MAX_MARK_VALUE = 500;
/** Un decimal como mucho: el valor por diez es entero. */
const DECIMAL_SCALE = 10;
/** El margen del punto flotante: 1,1 × 10 no da 11 exacto. */
const FLOAT_TOLERANCE = 1e-9;

/** La única unidad de las marcas por ahora (`0083_training.sql`). */
export type MarkUnit = "kg";

export type ClubMarkRecord = {
  readonly id: string;
  readonly name: string;
};

export type MemberMarkValueRecord = {
  readonly markId: string;
  readonly value: number;
};

type MemberOfClub = {
  readonly userId: string;
  readonly clubId: string;
};

type MarkOfMember = MemberOfClub & { readonly markId: string };

export type MemberMarksGateway = {
  /** Las marcas del club en su orden. */
  listClubMarks(clubId: string): Promise<readonly ClubMarkRecord[]>;
  listMemberValues(
    member: MemberOfClub,
  ): Promise<readonly MemberMarkValueRecord[]>;
  saveValue(entry: MarkOfMember & { readonly value: number }): Promise<void>;
  /** Sin valor que borrar, no hace nada. */
  clearValue(entry: MarkOfMember): Promise<void>;
};

export type MemberMarksGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly membership: MembershipGateway;
  readonly marks: MemberMarksGateway;
};

export type MemberMark = {
  readonly id: string;
  readonly name: string;
  readonly unit: MarkUnit;
  /** Nulo si el socio todavía no la puso. */
  readonly value: number | null;
};

export type MemberMarks = {
  readonly marks: readonly MemberMark[];
};

type MemberMarksRequest = {
  readonly callerId: string;
  readonly now: Date;
};

type MarkRequest = MemberMarksRequest & { readonly markId: string };

/** La puerta cerrada, con el motivo, como en el plan (RF-6). */
export class TrainingAccessBlockedError extends Error {
  readonly block: MembershipBlock;

  constructor(block: MembershipBlock) {
    super(`Las marcas están cerradas para una membresía ${block}.`);
    this.name = "TrainingAccessBlockedError";
    this.block = block;
  }
}

export class MemberMarkNotFoundError extends Error {
  constructor() {
    super("La marca no existe.");
    this.name = "MemberMarkNotFoundError";
  }
}

/** Más de 0 hasta 500, con un decimal como mucho (D11). Sólo números: la
 * coma decimal la convierte la pantalla (#902). */
export function isValidMarkValue(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return false;
  }
  if (value < MIN_MARK_VALUE || value > MAX_MARK_VALUE) {
    return false;
  }
  const scaled = value * DECIMAL_SCALE;
  return Math.abs(scaled - Math.round(scaled)) < FLOAT_TOLERANCE;
}

/** El club de quien llama si puede ver el plan; si no, el motivo. */
async function openMemberMarks(
  gateways: MemberMarksGateways,
  request: MemberMarksRequest,
): Promise<MemberOfClub> {
  const caller = await gateways.members.findRoleRequestMember(request.callerId);
  if (caller === null) {
    throw new MemberNotFoundError(request.callerId);
  }
  if (!PLANNER_ROLES.has(caller.role)) {
    const block = membershipBlockOf(
      await readMembership(gateways.membership, {
        userId: request.callerId,
        now: request.now,
      }),
    );
    if (block !== null) {
      throw new TrainingAccessBlockedError(block);
    }
  }
  return { userId: request.callerId, clubId: caller.clubId };
}

async function listMemberMarks(
  gateway: MemberMarksGateway,
  input: {
    readonly member: MemberOfClub;
    readonly clubMarks: readonly ClubMarkRecord[];
  },
): Promise<MemberMarks> {
  const values = await gateway.listMemberValues(input.member);
  const valueByMark = new Map(values.map((row) => [row.markId, row.value]));
  return {
    marks: input.clubMarks.map((mark) => ({
      id: mark.id,
      name: mark.name,
      unit: "kg",
      value: valueByMark.get(mark.id) ?? null,
    })),
  };
}

/** Abre la puerta, comprueba que la marca es del club y aplica `change`. */
async function changeMemberMark(
  gateways: MemberMarksGateways,
  request: MarkRequest,
  change: (entry: MarkOfMember) => Promise<void>,
): Promise<MemberMarks> {
  const member = await openMemberMarks(gateways, request);
  const clubMarks = await gateways.marks.listClubMarks(member.clubId);
  if (!clubMarks.some((mark) => mark.id === request.markId)) {
    throw new MemberMarkNotFoundError();
  }
  await change({ ...member, markId: request.markId });
  return listMemberMarks(gateways.marks, { member, clubMarks });
}

export async function readMemberMarks(
  gateways: MemberMarksGateways,
  request: MemberMarksRequest,
): Promise<MemberMarks> {
  const member = await openMemberMarks(gateways, request);
  const clubMarks = await gateways.marks.listClubMarks(member.clubId);
  return listMemberMarks(gateways.marks, { member, clubMarks });
}

/** El valor ya llega validado con `isValidMarkValue`; la base lo vuelve a
 * comprobar con su `check`. */
export function saveMemberMark(
  gateways: MemberMarksGateways,
  request: MarkRequest & { readonly value: number },
): Promise<MemberMarks> {
  return changeMemberMark(gateways, request, (entry) =>
    gateways.marks.saveValue({ ...entry, value: request.value }),
  );
}

export function clearMemberMark(
  gateways: MemberMarksGateways,
  request: MarkRequest,
): Promise<MemberMarks> {
  return changeMemberMark(gateways, request, (entry) =>
    gateways.marks.clearValue(entry),
  );
}
