import { describe, expect, it } from "vitest";
import type { AuditLogInsertRow, AuditLogWriter } from "@/lib/audit/audit-log";
import {
  MemberNotFoundError,
  type MemberAccountRecord,
  type MemberProfile,
} from "@/lib/auth/account-activation";
import { MemberToChangeNotFoundError } from "@/lib/auth/member-role-change";
import type { RoleRequestMember } from "@/lib/auth/role-request";
import type { Role } from "@/lib/auth/roles";
import {
  LastAdminDeactivationError,
  MemberStatusChangeForbiddenError,
  type MemberStatusChangeGateways,
  type MemberStatusWrite,
  type MemberStatusWriteInput,
  SelfDeactivationError,
  StatusChangeNotAuditedError,
  changeMemberStatus,
} from "@/lib/members/member-status-change";

/**
 * Dar de baja y reactivar a un miembro (FR-085, AC-040, RF-6 del PRD de E5),
 * contado sin Supabase delante. Que el club nunca se quede sin un Admin
 * activo lo garantiza `set_member_status` en la base; aquí se prueba quién
 * puede pedirlo, a qué estado vuelve una reactivación y qué queda en la
 * bitácora (NFR-010).
 */

const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const MEMBER_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const OTHER_CLUB_ID = "5c1ab000-0000-4000-8000-000000000002";
const ADMIN_NAME = "Ana Admin";

const COMPLETE_PROFILE: MemberProfile = {
  country: "AU",
  dateOfBirth: "1990-04-01",
  membershipType: "full",
  guardianConsentAt: null,
  registeredAt: "2026-01-10T00:00:00.000Z",
};

type FakeOptions = {
  readonly actorRole?: Role;
  readonly actor?: RoleRequestMember | null;
  readonly target?: Partial<MemberAccountRecord> | null;
  readonly isEmailConfirmed?: boolean;
  readonly write?: MemberStatusWrite;
  readonly auditFailure?: string;
};

type Fake = {
  readonly gateways: MemberStatusChangeGateways;
  readonly writes: MemberStatusWriteInput[];
  readonly auditRows: AuditLogInsertRow[];
};

function targetRecord(
  overrides: Partial<MemberAccountRecord>,
): MemberAccountRecord {
  return {
    memberId: "m-1",
    clubId: CLUB_ID,
    accountStatus: "inactive",
    profile: COMPLETE_PROFILE,
    ...overrides,
  };
}

function fakeGateways(options: FakeOptions = {}): Fake {
  const writes: MemberStatusWriteInput[] = [];
  const auditRows: AuditLogInsertRow[] = [];
  const actor: RoleRequestMember | null =
    options.actor === undefined
      ? {
          clubId: CLUB_ID,
          fullName: ADMIN_NAME,
          role: options.actorRole ?? "Admin",
        }
      : options.actor;
  const target =
    options.target === null ? null : targetRecord(options.target ?? {});
  const audit: AuditLogWriter = {
    async insertAuditLogRow(row) {
      if (options.auditFailure !== undefined) {
        return { error: { message: options.auditFailure } };
      }
      auditRows.push(row);
      return { error: null };
    },
  };

  return {
    writes,
    auditRows,
    gateways: {
      members: { findRoleRequestMember: async () => actor },
      accounts: { findByUserId: async () => target },
      identities: {
        isEmailConfirmed: async () => options.isEmailConfirmed ?? true,
      },
      statuses: {
        async applyStatusChange(input) {
          writes.push(input);
          return (
            options.write ?? {
              kind: "changed",
              previousStatus: "active",
              newStatus: input.newStatus,
            }
          );
        },
      },
      audit,
    },
  };
}

function deactivate(
  gateways: MemberStatusChangeGateways,
): ReturnType<typeof changeMemberStatus> {
  return changeMemberStatus(gateways, {
    actorId: ADMIN_ID,
    targetUserId: MEMBER_ID,
    status: "inactive",
  });
}

function reactivate(
  gateways: MemberStatusChangeGateways,
): ReturnType<typeof changeMemberStatus> {
  return changeMemberStatus(gateways, {
    actorId: ADMIN_ID,
    targetUserId: MEMBER_ID,
    status: "active",
  });
}

describe("baja y reactivación", () => {
  it("da de baja a un miembro del club del Admin", async () => {
    const fake = fakeGateways();

    const result = await deactivate(fake.gateways);

    expect(result).toEqual({
      userId: MEMBER_ID,
      previousStatus: "active",
      status: "inactive",
    });
    expect(fake.writes).toEqual([
      {
        targetUserId: MEMBER_ID,
        clubId: CLUB_ID,
        actorId: ADMIN_ID,
        newStatus: "inactive",
      },
    ]);
  });

  it("reactiva como activo a quien no le falta nada del registro", async () => {
    const fake = fakeGateways({
      write: {
        kind: "changed",
        previousStatus: "inactive",
        newStatus: "active",
      },
    });

    const result = await reactivate(fake.gateways);

    expect(result).toEqual({
      userId: MEMBER_ID,
      previousStatus: "inactive",
      status: "active",
    });
    expect(fake.writes[0]?.newStatus).toBe("active");
  });

  it.each<[string, FakeOptions]>([
    [
      "le falta un dato del perfil",
      { target: { profile: { ...COMPLETE_PROFILE, country: null } } },
    ],
    ["no confirmó su correo", { isEmailConfirmed: false }],
  ])(
    "reactiva como incompleto a quien %s, sin saltarse el registro",
    async (_label, options) => {
      const fake = fakeGateways(options);

      await reactivate(fake.gateways);

      expect(fake.writes[0]?.newStatus).toBe("incomplete");
    },
  );

  it("no mira el registro para dar de baja", async () => {
    const fake = fakeGateways({ target: null });

    await deactivate(fake.gateways);

    expect(fake.writes).toHaveLength(1);
  });

  it("no reactiva al miembro de otro club, y no escribe nada", async () => {
    const fake = fakeGateways({ target: { clubId: OTHER_CLUB_ID } });

    await expect(reactivate(fake.gateways)).rejects.toBeInstanceOf(
      MemberToChangeNotFoundError,
    );
    expect(fake.writes).toEqual([]);
  });

  it("no reactiva a un miembro que no existe", async () => {
    const fake = fakeGateways({ target: null });

    await expect(reactivate(fake.gateways)).rejects.toBeInstanceOf(
      MemberToChangeNotFoundError,
    );
    expect(fake.writes).toEqual([]);
  });

  it("responde que no existe cuando la base no lo encuentra en el club", async () => {
    const fake = fakeGateways({ write: { kind: "not_found" } });

    await expect(deactivate(fake.gateways)).rejects.toBeInstanceOf(
      MemberToChangeNotFoundError,
    );
  });

  it("un estado repetido no es un cambio y no deja entrada en la bitácora", async () => {
    const fake = fakeGateways({
      write: { kind: "unchanged", status: "inactive" },
    });

    const result = await deactivate(fake.gateways);

    expect(result).toEqual({
      userId: MEMBER_ID,
      previousStatus: "inactive",
      status: "inactive",
    });
    expect(fake.auditRows).toEqual([]);
  });

  it("rechaza dar de baja al último Admin", async () => {
    const fake = fakeGateways({
      write: { kind: "last_admin", previousStatus: "active" },
    });

    await expect(deactivate(fake.gateways)).rejects.toBeInstanceOf(
      LastAdminDeactivationError,
    );
  });

  it("rechaza que un Admin se dé de baja a sí mismo", async () => {
    const fake = fakeGateways({ write: { kind: "self_deactivation" } });

    await expect(deactivate(fake.gateways)).rejects.toBeInstanceOf(
      SelfDeactivationError,
    );
    expect(fake.auditRows).toEqual([]);
  });

  it.each<Role>(["Coach", "Committee", "Player"])(
    "un %s no puede cambiar el estado de nadie, y no se escribe nada",
    async (actorRole) => {
      const fake = fakeGateways({ actorRole });

      await expect(deactivate(fake.gateways)).rejects.toBeInstanceOf(
        MemberStatusChangeForbiddenError,
      );
      expect(fake.writes).toEqual([]);
    },
  );

  it("quien dejó de ser Admin antes del bloqueo recibe el mismo rechazo", async () => {
    const fake = fakeGateways({ write: { kind: "actor_not_admin" } });

    await expect(deactivate(fake.gateways)).rejects.toBeInstanceOf(
      MemberStatusChangeForbiddenError,
    );
  });

  it("quien llama sin fila de miembro no es nadie en el club", async () => {
    const fake = fakeGateways({ actor: null });

    await expect(deactivate(fake.gateways)).rejects.toBeInstanceOf(
      MemberNotFoundError,
    );
  });
});

describe("bitácora de estados", () => {
  it("registra quién, sobre quién, el estado anterior, el nuevo y el éxito", async () => {
    const fake = fakeGateways();

    await deactivate(fake.gateways);

    expect(fake.auditRows).toEqual([
      {
        club_id: CLUB_ID,
        actor_id: ADMIN_ID,
        action: "member.status_changed",
        entity_type: "member",
        entity_id: MEMBER_ID,
        result: "success",
        metadata: { previousStatus: "active", newStatus: "inactive" },
      },
    ]);
  });

  it("registra el rechazo del último Admin como fallo", async () => {
    const fake = fakeGateways({
      write: { kind: "last_admin", previousStatus: "active" },
    });

    await deactivate(fake.gateways).catch(() => undefined);

    expect(fake.auditRows).toEqual([
      {
        club_id: CLUB_ID,
        actor_id: ADMIN_ID,
        action: "member.status_changed",
        entity_type: "member",
        entity_id: MEMBER_ID,
        result: "failure",
        metadata: {
          previousStatus: "active",
          newStatus: "inactive",
          reason: "last_admin",
        },
      },
    ]);
  });

  it("no guarda nombres, sólo identificadores y estados", async () => {
    const fake = fakeGateways();

    await deactivate(fake.gateways);

    const written = JSON.stringify(fake.auditRows);
    expect(written).not.toContain(ADMIN_NAME);
  });

  it("si la bitácora falla tras el cambio, lo dice sin fingir un éxito", async () => {
    const fake = fakeGateways({ auditFailure: "sin conexión" });

    const failure = await deactivate(fake.gateways).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(StatusChangeNotAuditedError);
    expect((failure as StatusChangeNotAuditedError).change).toEqual({
      userId: MEMBER_ID,
      previousStatus: "active",
      status: "inactive",
    });
  });
});
