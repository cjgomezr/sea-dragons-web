import { MemberNotFoundError } from "./account-activation";
import type {
  RequestableRole,
  RoleRequestGateways,
  RoleRequestMember,
} from "./role-request";
import { type Role, hasCapability } from "./roles";

/**
 * Las dos lecturas de la pantalla de administración (#212, RF-8 del PRD de
 * E3), contadas sin Supabase delante: la bandeja de solicitudes pendientes y
 * la lista de socios del club.
 *
 * Las dos salen siempre del club de quien las pide, que se averigua de su fila
 * de socio y nunca de un parámetro. Es lo mismo que hacen `decideRoleRequest`
 * y `changeMemberRole`, y por el mismo motivo: un club no puede leerse los
 * datos de otro pidiéndolo bien (NFR-009).
 */

/** Un socio tal como lo lista la pantalla: lo justo para nombrarlo y cambiarle
 * el rol. Ni fecha de nacimiento, ni tutor, ni país (NFR-010): esos son del
 * perfil de E5, y esta pantalla no los enseña. El id es el `user_id`, el mismo
 * con el que `PATCH /api/v1/members/{id}/role` nombra al socio. */
export type ClubMember = {
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  readonly role: Role;
};

/** Una solicitud de la bandeja, con quién la pidió. A diferencia de la que ve
 * su autor en Mi cuenta, esta sí trae la justificación: es lo que el Admin
 * necesita para decidir. */
export type PendingRoleRequest = {
  readonly id: string;
  readonly userId: string;
  readonly fullName: string;
  readonly requestedRole: RequestableRole;
  readonly justification: string | null;
  readonly createdAt: string;
};

export type ClubAdministrationGateways = {
  readonly members: RoleRequestGateways["members"] & {
    findClubMembers(clubId: string): Promise<readonly ClubMember[]>;
  };
  readonly requests: {
    findPendingRequests(clubId: string): Promise<readonly PendingRoleRequest[]>;
  };
};

export class ClubAdministrationForbiddenError extends Error {
  constructor() {
    super("Sólo un Admin puede ver los socios y las solicitudes del club.");
    this.name = "ClubAdministrationForbiddenError";
  }
}

/** Quien pide, con su club. La frontera ya niega la lista de socios por la
 * ruta, pero la bandeja cuelga de un endpoint abierto a los cuatro roles
 * (`POST /api/v1/role-requests`), así que para esa lectura este es el cerrojo
 * que decide. */
async function findAdministrator(
  gateways: ClubAdministrationGateways,
  administratorId: string,
): Promise<RoleRequestMember> {
  const administrator =
    await gateways.members.findRoleRequestMember(administratorId);
  if (administrator === null) {
    throw new MemberNotFoundError(administratorId);
  }
  if (!hasCapability(administrator.role, "manageUsersAndRoles")) {
    throw new ClubAdministrationForbiddenError();
  }
  return administrator;
}

export async function listClubMembers(
  gateways: ClubAdministrationGateways,
  administratorId: string,
): Promise<readonly ClubMember[]> {
  const administrator = await findAdministrator(gateways, administratorId);
  return gateways.members.findClubMembers(administrator.clubId);
}

export async function listPendingRoleRequests(
  gateways: ClubAdministrationGateways,
  administratorId: string,
): Promise<readonly PendingRoleRequest[]> {
  const administrator = await findAdministrator(gateways, administratorId);
  return gateways.requests.findPendingRequests(administrator.clubId);
}
