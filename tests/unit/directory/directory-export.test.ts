import { beforeEach, describe, expect, it } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { Role } from "@/lib/auth/roles";
import { DEFAULT_CLUB_BRAND } from "@/lib/club/club-brand";
import {
  DEFAULT_DIRECTORY_QUERY,
  DirectoryFilterForbiddenError,
  type DirectoryMemberRecord,
} from "@/lib/directory/directory";
import {
  type DirectoryExportGateways,
  DirectoryExportForbiddenError,
  exportDirectory,
} from "@/lib/directory/directory-export";
import { DEFENDER, SEEDED_POSITIONS } from "../helpers/seeded-positions";

/**
 * La exportación del directorio (#500, RF-5 del PRD de E19): la misma lista
 * que la pantalla, en CSV, sólo para Admin y Committee, y apuntada en la
 * bitácora.
 */

const CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const TODAY_IN_CLUB = "2026-10-08";

const MARIA: DirectoryMemberRecord = {
  userId: "cccccccc-0000-4000-8000-00000000000c",
  fullName: "María Ñíguez",
  country: "AU",
  experienceLevel: "Intermediate",
  role: "Player",
  positionId: DEFENDER.id,
  status: "active",
  aufNumber: "AUF-7",
  aufExpiry: "2027-01-31",
  isAufVerified: true,
  photoPath: "fotos/maria.webp",
  isEvaluated: true,
  membershipStatus: "active",
  groupIds: [],
  email: "maria@club.test",
  phone: null,
  emergencyContact: null,
};

const TOMAS: DirectoryMemberRecord = {
  ...MARIA,
  userId: "dddddddd-0000-4000-8000-00000000000d",
  fullName: "Tomás Gil",
  phone: "0412 345 678",
};

type Harness = {
  readonly gateways: DirectoryExportGateways;
  readonly auditRows: AuditLogInsertRow[];
  readonly signedPhotoRequests: (readonly string[])[];
};

function harness(callerRole: Role | null): Harness {
  const auditRows: AuditLogInsertRow[] = [];
  const signedPhotoRequests: (readonly string[])[] = [];
  return {
    auditRows,
    signedPhotoRequests,
    gateways: {
      members: {
        findRoleRequestMember: async () =>
          callerRole === null
            ? null
            : { clubId: CLUB_ID, fullName: "Quien exporta", role: callerRole },
      },
      directory: { findDirectoryMembers: async () => [MARIA, TOMAS] },
      positions: { findClubPositions: async () => SEEDED_POSITIONS },
      photos: {
        signPhotoUrls: async (paths) => {
          signedPhotoRequests.push(paths);
          return new Map();
        },
      },
      attendance: { findMemberAttendance: async () => new Map() },
      brand: { readClubBrand: async () => DEFAULT_CLUB_BRAND },
      audit: {
        insertAuditLogRow: async (row) => {
          auditRows.push(row);
          return { error: null };
        },
      },
    },
  };
}

function exportAs(
  { gateways }: Harness,
  query = DEFAULT_DIRECTORY_QUERY,
): ReturnType<typeof exportDirectory> {
  return exportDirectory(gateways, {
    callerId: CALLER_ID,
    query,
    todayInClub: TODAY_IN_CLUB,
    locale: "es",
  });
}

let admin: Harness;

beforeEach(() => {
  admin = harness("Admin");
});

describe("exportDirectory", () => {
  it.each(["Admin", "Committee"] as const)(
    "da a un %s el CSV con un socio por fila y el nombre del archivo",
    async (role) => {
      const exported = await exportAs(harness(role));

      expect(exported.memberCount).toBe(2);
      expect(exported.filename).toBe(
        "victoria-seadragons-directorio-2026-10-08.csv",
      );
      expect(exported.csv.split("\r\n")).toHaveLength(4);
    },
  );

  it("exporta lo que deja el filtro, igual que la pantalla", async () => {
    const exported = await exportAs(admin, {
      ...DEFAULT_DIRECTORY_QUERY,
      withoutPhone: true,
    });

    expect(exported.memberCount).toBe(1);
    expect(exported.csv).toContain("María Ñíguez");
    expect(exported.csv).not.toContain("Tomás Gil");
  });

  it("no trae al Committee el AUF ni la membresía", async () => {
    const exported = await exportAs(harness("Committee"));

    expect(exported.csv).not.toContain("AUF");
    expect(exported.csv).not.toContain("Membresía");
  });

  it.each(["Coach", "Player"] as const)(
    "rechaza a un %s sin leer el directorio ni apuntar nada",
    async (role) => {
      const coach = harness(role);

      await expect(exportAs(coach)).rejects.toBeInstanceOf(
        DirectoryExportForbiddenError,
      );
      expect(coach.auditRows).toEqual([]);
    },
  );

  it("rechaza al Committee un filtro que sólo puede pedir un Admin", async () => {
    const committee = harness("Committee");

    await expect(
      exportAs(committee, { ...DEFAULT_DIRECTORY_QUERY, auf: "missing" }),
    ).rejects.toBeInstanceOf(DirectoryFilterForbiddenError);
    expect(committee.auditRows).toEqual([]);
  });

  it("rechaza a quien no es socio del club", async () => {
    await expect(exportAs(harness(null))).rejects.toBeInstanceOf(
      MemberNotFoundError,
    );
  });

  it("apunta en la bitácora quién exportó, con qué filtros y cuántos", async () => {
    await exportAs(admin, {
      ...DEFAULT_DIRECTORY_QUERY,
      role: "Player",
      withoutPhone: true,
    });

    expect(admin.auditRows).toEqual([
      {
        club_id: CLUB_ID,
        actor_id: CALLER_ID,
        action: "directory.exported",
        entity_type: "club",
        entity_id: CLUB_ID,
        result: "success",
        metadata: {
          filters: { role: "Player", withoutPhone: "true" },
          memberCount: 1,
        },
      },
    ]);
  });

  it("no entrega el archivo si la bitácora no se pudo escribir", async () => {
    const failing = harness("Admin");
    const gateways: DirectoryExportGateways = {
      ...failing.gateways,
      audit: {
        insertAuditLogRow: async () => ({ error: { message: "caída" } }),
      },
    };

    await expect(
      exportDirectory(gateways, {
        callerId: CALLER_ID,
        query: DEFAULT_DIRECTORY_QUERY,
        todayInClub: TODAY_IN_CLUB,
        locale: "es",
      }),
    ).rejects.toThrow("caída");
  });

  it("no firma fotos, que el CSV no lleva", async () => {
    await exportAs(admin);

    expect(admin.signedPhotoRequests.flat()).toEqual([]);
  });
});
