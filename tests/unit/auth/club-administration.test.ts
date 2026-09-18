import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  type ClubAdministrationGateways,
  ClubAdministrationForbiddenError,
  type ClubMember,
  type PendingRoleRequest,
  listClubMembers,
  listPendingRoleRequests,
} from "@/lib/auth/club-administration";
import type { Role } from "@/lib/auth/roles";

/**
 * Las dos lecturas de la pantalla de administración (#212, RF-8 del PRD de
 * E3): la bandeja de solicitudes pendientes y la lista de socios. Las dos
 * salen del club de quien las pide, y sólo las lee quien gestiona usuarios y
 * roles.
 */

const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

const MEMBERS: readonly ClubMember[] = [
  {
    userId: "b1b1b1b1-0000-4000-8000-00000000000b",
    fullName: "Nerea Ruiz",
    email: "nerea@example.test",
    role: "Player",
  },
  {
    userId: ADMIN_ID,
    fullName: "Ana Admin",
    email: "ana@example.test",
    role: "Admin",
  },
];

const PENDING: readonly PendingRoleRequest[] = [
  {
    id: "0f0e0d0c-0b0a-4908-8706-050403020100",
    userId: "b1b1b1b1-0000-4000-8000-00000000000b",
    fullName: "Nerea Ruiz",
    requestedRole: "Coach",
    justification: "Entreno a los juveniles.",
    createdAt: "2026-09-17T08:30:00.000Z",
  },
];

type GatewayOptions = {
  readonly role?: Role;
  readonly member?: null;
};

const clubsRead: string[] = [];

function gateways(options: GatewayOptions = {}): ClubAdministrationGateways {
  clubsRead.length = 0;
  return {
    members: {
      findRoleRequestMember: async () =>
        options.member === null
          ? null
          : {
              clubId: CLUB_ID,
              fullName: "Ana Admin",
              role: options.role ?? "Admin",
            },
      findClubMembers: async (clubId: string) => {
        clubsRead.push(clubId);
        return MEMBERS;
      },
    },
    requests: {
      findPendingRequests: async (clubId: string) => {
        clubsRead.push(clubId);
        return PENDING;
      },
    },
  };
}

describe("lista de socios del club", () => {
  it("devuelve los socios del club de quien la pide", async () => {
    const members = await listClubMembers(gateways(), ADMIN_ID);

    expect(members).toEqual(MEMBERS);
    expect(clubsRead).toEqual([CLUB_ID]);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "se la niega a un %s sin leer la base",
    async (role) => {
      await expect(
        listClubMembers(gateways({ role }), ADMIN_ID),
      ).rejects.toBeInstanceOf(ClubAdministrationForbiddenError);
      expect(clubsRead).toEqual([]);
    },
  );

  it("rechaza a una identidad que no es socia de ningún club", async () => {
    await expect(
      listClubMembers(gateways({ member: null }), ADMIN_ID),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});

describe("bandeja de solicitudes pendientes", () => {
  it("devuelve las pendientes del club de quien la pide", async () => {
    const requests = await listPendingRoleRequests(gateways(), ADMIN_ID);

    expect(requests).toEqual(PENDING);
    expect(clubsRead).toEqual([CLUB_ID]);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "se la niega a un %s sin leer la base",
    async (role) => {
      await expect(
        listPendingRoleRequests(gateways({ role }), ADMIN_ID),
      ).rejects.toBeInstanceOf(ClubAdministrationForbiddenError);
      expect(clubsRead).toEqual([]);
    },
  );

  it("rechaza a una identidad que no es socia de ningún club", async () => {
    await expect(
      listPendingRoleRequests(gateways({ member: null }), ADMIN_ID),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});
